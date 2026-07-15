// 声波接收模块 - 从麦克风/线路输入解码文本
const Receiver = {
  SAMPLE_RATE: 44100,
  BIT_MS: 25,
  FREQ_0: 1400,
  FREQ_1: 2400,
  PREAMBLE_BITS: 16,
  state: 'idle', // idle | listening | decoding | done

  async startListening(callback) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: this.SAMPLE_RATE, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const ctx = new AudioContext({ sampleRate: this.SAMPLE_RATE });
      const src = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      let buffer = new Float32Array(0);
      let detected = false;
      let bitBuffer = [];
      const bitLen = Math.floor(this.SAMPLE_RATE * this.BIT_MS / 1000);

      processor.onaudioprocess = (e) => {
        if (this.state === 'done') return;
        const input = e.inputBuffer.getChannelData(0);
        const combined = new Float32Array(buffer.length + input.length);
        combined.set(buffer, 0);
        combined.set(input, buffer.length);
        buffer = combined;

        // 尝试检测前导
        if (!detected) {
          // 寻找 2000Hz 提示音（能量峰值）
          let maxAmp = 0;
          for (let i = 0; i < input.length; i++) maxAmp = Math.max(maxAmp, Math.abs(input[i]));
          if (maxAmp > 0.2) {
            detected = true;
            this.state = 'listening';
            buffer = new Float32Array(0); // 重置，等待数据
            callback({ type: 'detected' });
          }
          return;
        }

        // 解码比特
        while (buffer.length >= bitLen) {
          const chunk = buffer.slice(0, bitLen);
          buffer = buffer.slice(bitLen);
          const bit = this.detectBit(chunk);
          bitBuffer.push(bit);

          if (bitBuffer.length >= this.PREAMBLE_BITS + 16) {
            this.tryDecode(bitBuffer, callback);
          }
        }
      };

      src.connect(processor);
      processor.connect(ctx.destination);
      this._ctx = ctx;
      this._stream = stream;
      this._processor = processor;

      callback({ type: 'ready' });
    } catch (err) {
      callback({ type: 'error', message: '无法访问麦克风: ' + err.message });
    }
  },

  detectBit(samples) {
    let e0 = 0, e1 = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const g0 = Math.sin(2 * Math.PI * this.FREQ_0 * i / this.SAMPLE_RATE);
      const g1 = Math.sin(2 * Math.PI * this.FREQ_1 * i / this.SAMPLE_RATE);
      e0 += x * g0;
      e1 += x * g1;
    }
    return e1 > e0 ? 1 : 0;
  },

  tryDecode(bitBuffer, callback) {
    // 找前导 0xAA55
    const preamble = [1,0,1,0,1,0,1,0, 0,1,0,1,0,1,0,1];
    let preIdx = -1;
    for (let i = 0; i <= bitBuffer.length - this.PREAMBLE_BITS; i++) {
      let match = true;
      for (let j = 0; j < this.PREAMBLE_BITS; j++) {
        if (bitBuffer[i + j] !== preamble[j]) { match = false; break; }
      }
      if (match) { preIdx = i; break; }
    }
    if (preIdx < 0) return;

    const dataStart = preIdx + this.PREAMBLE_BITS;
    const needBits = 16; // at least length field
    if (bitBuffer.length < dataStart + needBits) return;

    // 读长度
    let len = 0;
    for (let i = 0; i < 16; i++) len = (len << 1) | bitBuffer[dataStart + i];
    if (len < 1 || len > 2000) return;

    const totalNeed = this.PREAMBLE_BITS + 16 + len * 8 + 8;
    if (bitBuffer.length < preIdx + totalNeed) return;

    // 读数据
    const bytes = new Uint8Array(len);
    for (let b = 0; b < len; b++) {
      let val = 0;
      for (let i = 0; i < 8; i++) val = (val << 1) | bitBuffer[preIdx + this.PREAMBLE_BITS + 16 + b * 8 + i];
      bytes[b] = val;
    }

    // 校验
    let cksum = 0;
    for (const b of bytes) cksum ^= b;
    const ckStart = preIdx + this.PREAMBLE_BITS + 16 + len * 8;
    let recvCk = 0;
    for (let i = 0; i < 8; i++) recvCk = (recvCk << 1) | bitBuffer[ckStart + i];
    if (cksum !== recvCk) { callback({ type: 'checksum_error' }); return; }

    const decoder = new TextDecoder();
    const text = decoder.decode(bytes);
    this.state = 'done';
    callback({ type: 'decoded', text });
  },

  stop() {
    this.state = 'idle';
    if (this._processor) this._processor.disconnect();
    if (this._ctx) this._ctx.close();
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
  },
};
