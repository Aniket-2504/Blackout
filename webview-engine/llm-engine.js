// llm-engine.js
// Tier-2 semantic verifier. Loaded as a plain <script> tag, same pattern
// as face_detection.js. Exposes window.LlmEngine with an init() and an
// evaluate() call. Runs ONLY on state transitions, never per-frame.

window.LlmEngine = (function () {
  let llmInference = null;
  let isReady = false;
  let isSupported = null; // null = unknown, true/false once checked

  const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/llm-inference/gemma-2b-it-gpu-int4/float16/1/gemma-2b-it-gpu-int4.bin';

  // FIX-equivalent: WebGPU is required by tasks-genai in-browser. Check
  // BEFORE trying to load a multi-hundred-MB model, so a device without
  // support fails fast and visibly instead of hanging.
  async function checkSupport() {
    if (isSupported !== null) return isSupported;
    isSupported = !!navigator.gpu;
    return isSupported;
  }

  async function init() {
    const supported = await checkSupport();
    if (!supported) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'LLM_UNAVAILABLE',
        reason: 'WebGPU not available in this WebView',
      }));
      return false;
    }

    try {
      const genai = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/genai_bundle.mjs'
      );
      const fileset = await genai.FilesetResolver.forGenAiTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm'
      );
      llmInference = await genai.LlmInference.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL },
        maxTokens: 64,
        topK: 40,
        temperature: 0.2,
        randomSeed: 1,
      });
      isReady = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'LLM_READY' }));
      return true;
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'LLM_UNAVAILABLE',
        reason: String(err),
      }));
      return false;
    }
  }

  // Called only when the vision layer transitions SAFE -> LOCKDOWN.
  // Returns a confidence label the phone can log / show, it does NOT
  // gate the HUD itself -- vision stays the fast path, LLM is a
  // corroborating signal shown alongside it, not a blocking one.
  async function evaluate(reason, faceCount) {
    if (!isReady || !llmInference) return null;

    const prompt =
      `System: You are a concise security triage assistant for a laptop privacy tool.\n` +
      `Event: "${reason}". Faces currently in frame: ${faceCount}.\n` +
      `In one short sentence, state whether this looks like a genuine ` +
      `shoulder-surfing risk or likely a false positive, and why.`;

    try {
      const output = await llmInference.generateResponse(prompt);
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'LLM_VERDICT',
        verdict: output,
      }));
      return output;
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'LLM_ERROR',
        error: String(err),
      }));
      return null;
    }
  }

  return { init, evaluate, isReady: () => isReady };
})();