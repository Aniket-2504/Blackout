// identity-engine.js
// Tier-1 identity verifier: confirms WHO a detected face belongs to,
// using an enrolled selfie. Runs on-device via face-api.js (TF.js).
// Deliberately decoupled from the fast per-frame gaze/dwell loop --
// MediaPipe FaceDetection stays the 20fps path, this only fires
// periodically per tracked face (see IDENTITY_INTERVAL_MS).

window.IdentityEngine = (function () {
  const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
  const MATCH_THRESHOLD = 0.55; // lower = same person more likely; face-api convention ~0.6
  const IDENTITY_INTERVAL_MS = 400; // how often a given tracked face gets re-checked
  const DETECTOR_OPTS = new_ftd_opts();

  function new_ftd_opts() {
    // Small inputSize because we feed it a pre-cropped face, not a full frame.
    return { inputSize: 160, scoreThreshold: 0.5 };
  }

  let modelsReady = false;
  let operatorDescriptor = null; // Float32Array(128) or null if not enrolled

  async function loadModels() {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      modelsReady = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'IDENTITY_MODELS_READY' }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'IDENTITY_MODELS_FAILED', error: String(err),
      }));
    }
  }

  // Called once from React Native with a base64 data URL of the user's selfie.
  async function enroll(base64Image) {
    if (!modelsReady) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'ENROLL_FAILED', error: 'Models not loaded yet',
      }));
      return;
    }
    try {
      const img = new Image();
      img.src = base64Image;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const result = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions(DETECTOR_OPTS))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!result) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          action: 'ENROLL_FAILED', error: 'No face found in selfie',
        }));
        return;
      }

      operatorDescriptor = result.descriptor;
      window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'ENROLL_DONE' }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        action: 'ENROLL_FAILED', error: String(err),
      }));
    }
  }

  function clearEnrollment() {
    operatorDescriptor = null;
  }

  function hasOperator() {
    return operatorDescriptor !== null;
  }

  // cropCanvas: an offscreen canvas already cropped to roughly the face
  // region (see extractFaceCrop in the main script).
  // Returns 'operator', 'bystander', or null (couldn't get a descriptor).
  async function identifyCrop(cropCanvas) {
    if (!modelsReady || !operatorDescriptor) return null;
    try {
      const result = await faceapi
        .detectSingleFace(cropCanvas, new faceapi.TinyFaceDetectorOptions(DETECTOR_OPTS))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!result) return null;
      const distance = faceapi.euclideanDistance(operatorDescriptor, result.descriptor);
      return distance < MATCH_THRESHOLD ? 'operator' : 'bystander';
    } catch (err) {
      return null;
    }
  }

  return {
    loadModels,
    enroll,
    clearEnrollment,
    hasOperator,
    identifyCrop,
    isModelsReady: () => modelsReady,
    IDENTITY_INTERVAL_MS,
  };
})();