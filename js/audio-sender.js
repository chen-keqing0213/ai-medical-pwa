// 声波发送模块 - 将文本编码为音频信号通过耳机孔输出
const Sender = {
  SAMPLE_RATE: 44100,
  BIT_MS: 25,        // 每位时长
  FREQ_0: 1400,      // 0 的频率
  FREQ_1: 2400,      // 1 的频率
  PREAMBLE_BITS: 16, // 前导同步位

  // 生成单个频率的采样数据
  genTone(freq, durationMs, volume) {
    const n = Math.floor(this.SAMPLE_RATE * durationMs / 1000);
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      buf[i] = Math.sin(2 * Math.PI * freq * i / this.SAMPLE_RATE) * volume;
    }
    // 淡入淡出
    const fade = Math.min(40, Math.floor(n / 6));
    for (let i = 0; i < fade; i++) { buf[i] *= i / fade; buf[n-1-i] *= i / fade; }
    return buf;
  },

  // 生成静音
  genSilence(durationMs) {
    return new Float32Array(Math.floor(this.SAMPLE_RATE * durationMs / 1000));
  },

  // 文本 → 音频
  encode(text) {
    // 转 UTF-8 字节
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    if (bytes.length > 2000) throw new Error('文本过长');

    // 构建比特流: [16位前导 0xAA 0x55] [16位长度] [数据] [8位校验]
    const totalBits = this.PREAMBLE_BITS + 16 + bytes.length * 8 + 8;
    const bits = new Uint8Array(totalBits);

    // 前导 0xAA55 (10101010 01010101)
    const preamble = [1,0,1,0,1,0,1,0, 0,1,0,1,0,1,0,1];
    for (let i = 0; i < 16; i++) bits[i] = preamble[i];

    // 长度
    for (let i = 0; i < 16; i++) bits[16 + i] = (bytes.length >> (15 - i)) & 1;

    // 数据
    for (let b = 0; b < bytes.length; b++) {
      for (let i = 0; i < 8; i++) {
        bits[32 + b * 8 + i] = (bytes[b] >> (7 - i)) & 1;
      }
    }

    // 校验（异或）
    let cksum = 0;
    for (const b of bytes) cksum ^= b;
    for (let i = 0; i < 8; i++) {
      bits[32 + bytes.length * 8 + i] = (cksum >> (7 - i)) & 1;
    }

    // 生成波形
    const bitLen = this.SAMPLE_RATE * this.BIT_MS / 1000;
    const outLen = totalBits * bitLen;
    const out = new Float32Array(outLen);

    for (let i = 0; i < totalBits; i++) {
      const freq = bits[i] ? this.FREQ_1 : this.FREQ_0;
      const start = Math.floor(i * bitLen);
      for (let j = 0; j < bitLen; j++) {
        out[start + j] = Math.sin(2 * Math.PI * freq * j / this.SAMPLE_RATE) * 0.8;
      }
    }

    return out;
  },

  // 播放
  async play(audioData) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.SAMPLE_RATE });
    const buf = ctx.createBuffer(1, audioData.length, this.SAMPLE_RATE);
    buf.getChannelData(0).set(audioData);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    return new Promise(resolve => {
      src.onended = () => { ctx.close(); resolve(); };
    });
  },

  // 一键发送
  async send(text) {
    // 前导音 + 数据
    const pre = this.genTone(2000, 200, 0.6); // 200ms 提示音
    const gap = this.genSilence(100);
    const data = this.encode(text);
    const full = new Float32Array(pre.length + gap.length + data.length);
    full.set(pre, 0);
    full.set(gap, pre.length);
    full.set(data, pre.length + gap.length);
    return this.play(full);
  },
};
