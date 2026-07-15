// Vercel Serverless Function - 代理 DeepSeek API
// 部署：vercel --prod

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { systemPrompt, fields } = req.body;
    if (!fields) return res.status(400).json({ error: '缺少病历信息' });

    const summary = buildSummary(fields);
    const fullPrompt = `${systemPrompt}\n\n---\n以下是患者的临床信息：\n\n${summary}\n\n---\n请根据以上信息生成规范的首次病程记录。`;

    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一名经验丰富的中国临床医师，擅长书写符合《病历书写基本规范》的病历文书。回答必须专业、准确、规范，无AI痕迹。' },
          { role: 'user', content: fullPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      }),
    });

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('API返回空内容');

    // 拼接免责声明
    const record = content.trim() + '\n\n※ AI生成草稿，请医师审核修改后使用';

    return res.status(200).json({ success: true, record });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(200).json({
      success: true,
      record: buildFallback(req.body.fields),
      isFallback: true,
    });
  }
}

function buildSummary(fields) {
  const labels = {
    chief_complaint: '主诉', present_illness: '现病史', past_history: '既往史',
    vital_signs: '生命体征', physical_exam: '体格检查', aux_exam: '辅助检查',
    diagnosis: '初步诊断考虑', diagnosis_basis: '诊断依据', differential: '需鉴别的诊断',
    exam_plan: '检查计划', treatment_plan: '治疗计划',
  };
  return Object.entries(fields)
    .filter(([,v]) => v && v.trim())
    .map(([k, v]) => `${labels[k] || k}：${v.trim()}`)
    .join('\n');
}

function buildFallback(fields) {
  return `【首次病程记录 - 草稿】

一、病例特点
主诉：${fields.chief_complaint || '【待补充】'}
现病史：${fields.present_illness || '【待补充】'}
既往史：${fields.past_history || '【待补充】'}
生命体征：${fields.vital_signs || '【待补充】'}
体格检查：${fields.physical_exam || '【待补充】'}
辅助检查：${fields.aux_exam || '【待补充】'}

二、拟诊讨论
初步诊断：${fields.diagnosis || '【待补充】'}
诊断依据：${fields.diagnosis_basis || '【待补充】'}
鉴别诊断：${fields.differential || '【待补充】'}

三、诊疗计划
检查计划：${fields.exam_plan || '【待补充】'}
治疗计划：${fields.treatment_plan || '【待补充】'}

※ AI生成草稿，请医师审核修改后使用`;
}
