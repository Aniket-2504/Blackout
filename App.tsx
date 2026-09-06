// App.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  StatusBar,
  SafeAreaView,
  PermissionsAndroid,
  Platform,
  TouchableOpacity,
  AppState,
  AppStateStatus,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { launchCamera } from 'react-native-image-picker';
import KeepAwake from '@sayem314/react-native-keep-awake';

const SafeWebView = WebView as any;
const SafeStatusBar = StatusBar as any;
type CameraMode = 'environment' | 'user';

const PIPELINE_ENGINE_HTML = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body, html { width: 100%; height: 100%; background: #000; overflow: hidden; }
      #stage { position: relative; width: 100%; height: 100%; }
      video { width: 100%; height: 100%; object-fit: cover; display: block; }
      canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js" crossorigin="anonymous"></script>
  </head>
  <body>
    <div id="stage">
      <video id="webcam" autoplay playsinline muted></video>
      <canvas id="trackerCanvas"></canvas>
    </div>

    <script>
      window.IdentityEngine = (function () {
        const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
        const MATCH_THRESHOLD = 0.55;
        const IDENTITY_INTERVAL_MS = 400;
        const DETECTOR_OPTS = { inputSize: 160, scoreThreshold: 0.5 };
        const MODEL_LOAD_TIMEOUT_MS = 20000;

        let modelsReady = false;
        let operatorDescriptor = null;

        function withTimeout(promise, ms) {
          return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Model load timed out')), ms)),
          ]);
        }

        async function loadModels() {
          try {
            await withTimeout(Promise.all([
              faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
              faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
              faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            ]), MODEL_LOAD_TIMEOUT_MS);
            modelsReady = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'IDENTITY_MODELS_READY' }));
          } catch (err) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'IDENTITY_MODELS_FAILED', error: String(err) }));
          }
        }

        async function enroll(base64Image) {
          if (!modelsReady) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'ENROLL_FAILED', error: 'Models not loaded yet' }));
            return;
          }
          try {
            const img = new Image();
            img.src = base64Image;
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

            const result = await faceapi
              .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions(DETECTOR_OPTS))
              .withFaceLandmarks()
              .withFaceDescriptor();

            if (!result) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'ENROLL_FAILED', error: 'No face found in selfie' }));
              return;
            }
            operatorDescriptor = result.descriptor;
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'ENROLL_DONE' }));
          } catch (err) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'ENROLL_FAILED', error: String(err) }));
          }
        }

        function clearEnrollment() { operatorDescriptor = null; }
        function hasOperator() { return operatorDescriptor !== null; }

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

        return { loadModels, enroll, clearEnrollment, hasOperator, identifyCrop, isModelsReady: () => modelsReady, IDENTITY_INTERVAL_MS };
      })();

      window.enrollOperatorFace = function (base64Image) { window.IdentityEngine.enroll(base64Image); };
      window.clearOperatorEnrollment = function () { window.IdentityEngine.clearEnrollment(); };
      window.retryIdentityModelLoad = function () { window.IdentityEngine.loadModels(); };

      window.LlmEngine = (function () {
        let llmInference = null;
        let isReady = false;
        let isSupported = null;

        const MODEL_URL =
          'https://storage.googleapis.com/mediapipe-models/llm-inference/gemma-2b-it-gpu-int4/float16/1/gemma-2b-it-gpu-int4.bin';

        async function checkSupport() {
          if (isSupported !== null) return isSupported;
          isSupported = !!navigator.gpu;
          return isSupported;
        }

        async function init() {
          const supported = await checkSupport();
          if (!supported) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              action: 'LLM_UNAVAILABLE', reason: 'WebGPU not available in this WebView',
            }));
            return false;
          }
          try {
            const genai = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/genai_bundle.mjs');
            const fileset = await genai.FilesetResolver.forGenAiTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');
            llmInference = await genai.LlmInference.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: MODEL_URL },
              maxTokens: 64, topK: 40, temperature: 0.2, randomSeed: 1,
            });
            isReady = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'LLM_READY' }));
            return true;
          } catch (err) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'LLM_UNAVAILABLE', reason: String(err) }));
            return false;
          }
        }

        async function evaluate(reason, faceCount) {
          if (!isReady || !llmInference) return null;
          const prompt =
            'System: You are a concise security triage assistant for a laptop privacy tool.\\n' +
            'Event: "' + reason + '". Faces currently in frame: ' + faceCount + '.\\n' +
            'In one short sentence, state whether this looks like a genuine ' +
            'shoulder-surfing risk or likely a false positive, and why.';
          try {
            const output = await llmInference.generateResponse(prompt);
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'LLM_VERDICT', verdict: output }));
            return output;
          } catch (err) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'LLM_ERROR', error: String(err) }));
            return null;
          }
        }

        return { init, evaluate, isReady: () => isReady };
      })();

      const video = document.getElementById('webcam');
      const canvas = document.getElementById('trackerCanvas');
      const ctx = canvas.getContext('2d');

      let currentStream = null;
      let bootId = 0;
      let isBooting = false;
      let activeFacing = 'environment';

      let isProcessing = false;
      let activeSystemState = 'SAFE'; // SAFE, LOCKDOWN, AWAY

      const LOCK_DWELL_MS = 650;
      const RECOVER_DWELL_MS = 900;
      let threatSince = null;
      let clearSince = performance.now();
      let awaySince = null; // NEW: Timer for operator absence

      let trackedOperator = null;
      let calibrationFramesLeft = 0;
      const CALIBRATION_FRAMES = 15;
      const OPERATOR_LOST_MS = 1500;

      let trackedFaces = [];
      const FACE_MATCH_RADIUS = 0.12;
      const offscreenCanvas = document.createElement('canvas');
      const offscreenCtx = offscreenCanvas.getContext('2d');

      function resetTrackingState() {
        activeSystemState = 'SAFE';
        threatSince = null;
        awaySince = null;
        clearSince = performance.now();
        trackedOperator = null;
        calibrationFramesLeft = CALIBRATION_FRAMES;
        trackedFaces = [];
      }

      let coverT = { scale: 1, offsetX: 0, offsetY: 0, videoW: 0, videoH: 0 };

      function recomputeCoverTransform() {
        const stageW = canvas.clientWidth;
        const stageH = canvas.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = stageW * dpr;
        canvas.height = stageH * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const scale = Math.max(stageW / vw, stageH / vh);
        coverT = { scale, offsetX: (stageW - vw * scale) / 2, offsetY: (stageH - vh * scale) / 2, videoW: vw, videoH: vh };
      }
      window.addEventListener('resize', recomputeCoverTransform);

      function toCanvasPoint(nx, ny) {
        return {
          x: coverT.offsetX + nx * coverT.videoW * coverT.scale,
          y: coverT.offsetY + ny * coverT.videoH * coverT.scale,
        };
      }

      const L_CHEEK = 234, R_CHEEK = 454;
      const NOSE_TIP = 1;
      const LEFT_IRIS = 468, RIGHT_IRIS = 473;
      const LEFT_EYE_OUTER = 33, LEFT_EYE_INNER = 133;

      function meshToFace(landmarks) {
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const p of landmarks) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return {
          landmarks,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          width: maxX - minX,
          height: maxY - minY,
        };
      }

      function estimateGaze(landmarks) {
        const lCheek = landmarks[L_CHEEK], rCheek = landmarks[R_CHEEK];
        const nose = landmarks[NOSE_TIP];
        if (!lCheek || !rCheek || !nose) {
          return { facingScreen: true, confidence: 'low' };
        }

        const faceWidth = Math.abs(rCheek.x - lCheek.x);
        if (faceWidth < 0.005) {
          return { facingScreen: true, confidence: 'low' };
        }
        const midX = (lCheek.x + rCheek.x) / 2;
        const yawRatio = Math.abs(nose.x - midX) / faceWidth;

        if (yawRatio > 0.45) {
          return { facingScreen: false, confidence: 'high' };
        }

        return { facingScreen: true, confidence: 'high' };
      }

      function extractFaceCrop(face) {
        const padding = 0.35;
        const x = Math.max(0, (face.cx - face.width / 2 - face.width * padding) * video.videoWidth);
        const y = Math.max(0, (face.cy - face.height / 2 - face.height * padding) * video.videoHeight);
        const w = Math.min(video.videoWidth - x, face.width * (1 + padding * 2) * video.videoWidth);
        const h = Math.min(video.videoHeight - y, face.height * (1 + padding * 2) * video.videoHeight);
        offscreenCanvas.width = w; offscreenCanvas.height = h;
        offscreenCtx.drawImage(video, x, y, w, h, 0, 0, w, h);
        const frozen = document.createElement('canvas');
        frozen.width = w; frozen.height = h;
        frozen.getContext('2d').drawImage(offscreenCanvas, 0, 0);
        return frozen;
      }

      function matchTrackedFace(f) {
        let best = null, bestDist = FACE_MATCH_RADIUS;
        for (const t of trackedFaces) {
          const d = Math.hypot(f.cx - t.cx, f.cy - t.cy);
          if (d < bestDist) { bestDist = d; best = t; }
        }
        return best;
      }

      function classifyFaces(faces) {
        const now = performance.now();
        const stillTracked = [];
        for (const f of faces) {
          let t = matchTrackedFace(f);
          if (!t) t = { cx: f.cx, cy: f.cy, label: 'unknown', lastCheck: 0 };
          else { t.cx = f.cx; t.cy = f.cy; }

          const dueForCheck = now - t.lastCheck > window.IdentityEngine.IDENTITY_INTERVAL_MS;
          if (dueForCheck && window.IdentityEngine.isModelsReady()) {
            t.lastCheck = now;
            const crop = extractFaceCrop(f);
            window.IdentityEngine.identifyCrop(crop).then((label) => { if (label) t.label = label; });
          }
          f.identityLabel = t.label;
          stillTracked.push(t);
        }
        trackedFaces = stillTracked;
      }

      const OPERATOR_SMOOTHING_ALPHA = 0.4;

      function pickOperator(faces) {
        if (!faces.length) return trackedOperator;
        if (!trackedOperator || calibrationFramesLeft > 0) {
          let best = faces[0], bestDist = Math.hypot(best.cx - 0.5, best.cy - 0.5);
          for (const f of faces) {
            const d = Math.hypot(f.cx - 0.5, f.cy - 0.5);
            if (d < bestDist || (d === bestDist && f.width * f.height > best.width * best.height)) { best = f; bestDist = d; }
          }
          trackedOperator = { cx: best.cx, cy: best.cy, width: best.width, lastSeen: performance.now() };
          calibrationFramesLeft = Math.max(0, calibrationFramesLeft - 1);
          return trackedOperator;
        }
        let nearest = null, nearestDist = Infinity;
        for (const f of faces) {
          const d = Math.hypot(f.cx - trackedOperator.cx, f.cy - trackedOperator.cy);
          if (d < nearestDist) { nearestDist = d; nearest = f; }
        }
        const dynamicRadius = Math.max(0.10, trackedOperator.width * 0.7);
        if (nearest && nearestDist < dynamicRadius) {
          trackedOperator = {
            cx: trackedOperator.cx + (nearest.cx - trackedOperator.cx) * OPERATOR_SMOOTHING_ALPHA,
            cy: trackedOperator.cy + (nearest.cy - trackedOperator.cy) * OPERATOR_SMOOTHING_ALPHA,
            width: nearest.width,
            lastSeen: performance.now(),
          };
        } else if (performance.now() - trackedOperator.lastSeen > OPERATOR_LOST_MS) {
          trackedOperator = null;
          calibrationFramesLeft = CALIBRATION_FRAMES;
        }
        return trackedOperator;
      }

      function isOperatorFace(f, operator) {
        if (!operator) return false;
        const dynamicRadius = Math.max(0.10, operator.width * 0.7);
        return Math.hypot(f.cx - operator.cx, f.cy - operator.cy) < dynamicRadius;
      }

      function drawFaceOutline(face, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        const tl = toCanvasPoint(face.cx - face.width / 2, face.cy - face.height / 2);
        const w = face.width * coverT.videoW * coverT.scale;
        const h = face.height * coverT.videoH * coverT.scale;
        
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(tl.x, tl.y, w, h, [14]);
        } else {
          ctx.rect(tl.x, tl.y, w, h);
        }
        ctx.stroke();
      }

      function onResults(results) {
        ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        const rawFaces = results.multiFaceLandmarks || [];
        const faces = rawFaces.map(meshToFace);

        let frameThreat = false;
        let frameAway = false;
        let threatReason = '';

        if (activeFacing === 'user') {
          // If 0 faces detected, Operator has physically left
          if (faces.length === 0) {
            frameAway = true;
          } else if (faces.length > 1) {
            faces.sort((a, b) => (b.width * b.height) - (a.width * a.height));
            const operator = faces[0];
            const bystanders = faces.slice(1);

            for (const bystander of bystanders) {
              const gaze = estimateGaze(bystander.landmarks);
              if (gaze.facingScreen) {
                frameThreat = true;
                threatReason = 'Shoulder Surfer Detected (' + faces.length + ' Faces)';
                break;
              }
            }

            drawFaceOutline(operator, '#FACC15');
            for (const bystander of bystanders) {
              drawFaceOutline(bystander, frameThreat ? '#EF4444' : '#FACC15');
            }
          } else if (faces.length === 1) {
            drawFaceOutline(faces[0], '#FACC15');
          }
        } else {
          // Rear camera is unaffected by 'away' detection
          for (const f of faces) {
            const gaze = estimateGaze(f.landmarks);
            if (gaze.facingScreen) {
              frameThreat = true;
              threatReason = 'Perimeter Intruder (' + faces.length + ' Target)';
            }
          }
          for (const f of faces) drawFaceOutline(f, frameThreat ? '#EF4444' : '#FACC15');
        }

        const now = performance.now();
        
        if (frameThreat) {
          if (threatSince === null) threatSince = now;
          clearSince = null;
          awaySince = null;
          if (activeSystemState !== 'LOCKDOWN' && (now - threatSince) >= 150) {
            activeSystemState = 'LOCKDOWN';
            window.ReactNativeWebView.postMessage(JSON.stringify({
              action: 'STATE_CHANGE', state: 'LOCKDOWN', reason: threatReason
            }));
            if (window.LlmEngine && window.LlmEngine.isReady()) {
              window.LlmEngine.evaluate(threatReason, faces.length);
            }
          }
        } else if (frameAway) {
          clearSince = null;
          threatSince = null;
          if (awaySince === null) awaySince = now;
          if (activeSystemState !== 'AWAY' && (now - awaySince) >= 1500) {
            activeSystemState = 'AWAY';
            window.ReactNativeWebView.postMessage(JSON.stringify({
              action: 'STATE_CHANGE', state: 'AWAY', reason: 'Operator Absent (Auto-Lock Timer Active)'
            }));
          }
        } else {
          awaySince = null;
          if (clearSince === null) clearSince = now;
          threatSince = null;
          if (activeSystemState !== 'SAFE' && (now - clearSince) >= 300) {
            activeSystemState = 'SAFE';
            window.ReactNativeWebView.postMessage(JSON.stringify({
              action: 'STATE_CHANGE', state: 'SAFE',
              reason: activeFacing === 'user' ? 'Operator Verified (Perimeter Clear)' : 'Perimeter Secured (Clear)'
            }));
          }
        }
        isProcessing = false;
      }

      const faceMesh = new FaceMesh({
        locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/' + file
      });
      faceMesh.setOptions({
        maxNumFaces: 4,
        refineLandmarks: true,
        minDetectionConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
      faceMesh.onResults(onResults);

      async function bootCamera(facing) {
        const myBootId = ++bootId;
        isBooting = true;
        try {
          if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
          const constraints = { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false };
          let stream;
          try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
          catch (e) { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
          if (myBootId !== bootId) { stream.getTracks().forEach(t => t.stop()); return; }
          currentStream = stream;
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            if (myBootId !== bootId) return;
            video.play();
            recomputeCoverTransform();
            resetTrackingState();
            window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'SWITCH_DONE' }));
          };
        } catch (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'CAMERA_ERROR', error: String(err) }));
        } finally {
          isBooting = false;
        }
      }

      window.switchCameraLens = function (targetFacing) {
        activeFacing = targetFacing;
        bootCamera(targetFacing);
      };

      setInterval(async () => {
        if (!isProcessing && !isBooting && video.readyState === 4) {
          isProcessing = true;
          await faceMesh.send({ image: video });
        }
      }, 40);

      window.addEventListener('DOMContentLoaded', () => {
        window.IdentityEngine.loadModels();
        window.LlmEngine.init();
      });
    </script>
  </body>
  </html>
`;

export default function App() {
  const [status, setStatus] = useState<'SAFE' | 'LOCKDOWN' | 'AWAY'>('SAFE');
  const [reason, setReason] = useState('Perimeter Monitoring Active');
  const [interceptions, setInterceptions] = useState(0);
  const [connected, setConnected] = useState(false);
  const [activeFacing, setActiveFacing] = useState<CameraMode>('environment');
  const [isSwitching, setIsSwitching] = useState(false);
  const [identityModelsReady, setIdentityModelsReady] = useState(false);
  const [identityModelsFailed, setIdentityModelsFailed] = useState(false);
  const [operatorEnrolled, setOperatorEnrolled] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const webViewRef = useRef<any>(null);
  const currentStatusRef = useRef<'SAFE' | 'LOCKDOWN' | 'AWAY'>('SAFE');
  const activeFacingRef = useRef<CameraMode>('environment');

  const sendSocketPayload = (event: 'BLUR' | 'RESTORE' | 'AWAY', alertReason: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ event, reason: alertReason, timestamp: Date.now() }));
    }
  };

  const dispatchStateChange = useCallback((nextState: 'SAFE' | 'LOCKDOWN' | 'AWAY', alertReason: string) => {
    if (currentStatusRef.current === nextState) return;
    currentStatusRef.current = nextState;
    setStatus(nextState);
    setReason(alertReason);
    
    let socketEvent = 'RESTORE';
    if (nextState === 'LOCKDOWN') {
        setInterceptions(prev => prev + 1);
        socketEvent = 'BLUR';
    } else if (nextState === 'AWAY') {
        socketEvent = 'AWAY';
    }
    
    sendSocketPayload(socketEvent as any, alertReason);
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let heartbeatTimer: ReturnType<typeof setInterval>;

    const connect = () => {
      const socket = new WebSocket('ws://127.0.0.1:8000/ws');
      socket.onopen = () => {
        setConnected(true);
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: 'PING', timestamp: Date.now() }));
          }
        }, 1000);
      };
      socket.onclose = () => {
        setConnected(false);
        clearInterval(heartbeatTimer);
        reconnectTimer = setTimeout(connect, 2000);
      };
      socket.onerror = () => { setConnected(false); socket.close(); };
      ws.current = socket;
    };

    if (Platform.OS === 'android') {
      PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.CAMERA]);
    }
    connect();

    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState.match(/inactive|background/)) {
        dispatchStateChange('SAFE', 'App Minimized');
        sendSocketPayload('RESTORE', 'App Minimized');
      }
    });

    return () => {
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
      appStateSub.remove();
      if (ws.current) {
        sendSocketPayload('RESTORE', 'App Teardown');
        ws.current.close();
      }
    };
  }, [dispatchStateChange]);

  useEffect(() => { activeFacingRef.current = activeFacing; }, [activeFacing]);

  const switchCamera = (targetFacing: CameraMode) => {
    if (isSwitching || targetFacing === activeFacing) return;
    setIsSwitching(true);
    setActiveFacing(targetFacing);
    dispatchStateChange('SAFE', 'Camera Sensor Switching');
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (window.switchCameraLens) { window.switchCameraLens("${targetFacing}"); }
        true;
      `);
    }
  };

  const retryIdentityModelLoad = () => {
    setIdentityModelsFailed(false);
    webViewRef.current?.injectJavaScript(`window.retryIdentityModelLoad(); true;`);
  };

  const enrollOperatorFace = () => {
    launchCamera(
      { mediaType: 'photo', includeBase64: true, cameraType: 'front', quality: 0.8, saveToPhotos: false },
      (response) => {
        if (response.didCancel || response.errorCode || !response.assets?.[0]?.base64) return;
        const base64DataUrl = `data:image/jpeg;base64,${response.assets[0].base64}`;
        webViewRef.current?.injectJavaScript(`
          window.enrollOperatorFace(${JSON.stringify(base64DataUrl)});
          true;
        `);
      }
    );
  };

  const pipelineEngineHtml = useMemo(() => PIPELINE_ENGINE_HTML, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <SafeStatusBar barStyle="light-content" translucent={false} backgroundColor="#000000" />
      <View style={styles.container}>
        
        {/* Top Viewfinder Container */}
        <View style={styles.cameraFrame}>
          <SafeWebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: pipelineEngineHtml, baseUrl: 'https://localhost' }}
            style={styles.webview}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            androidHardwareAccelerationDisabled={false}
            onPermissionRequest={(event: any) => { event.grant(event.resources); }}
            onLoadEnd={() => {
              webViewRef.current?.injectJavaScript(`
                if (window.switchCameraLens) { window.switchCameraLens("${activeFacingRef.current}"); }
                true;
              `);
            }}
            onMessage={(event: any) => {
              try {
                const payload = JSON.parse(event.nativeEvent.data);
                if (payload.action === 'STATE_CHANGE') {
                  dispatchStateChange(payload.state, payload.reason);
                } else if (payload.action === 'SWITCH_DONE') {
                  setIsSwitching(false);
                } else if (payload.action === 'CAMERA_ERROR') {
                  setIsSwitching(false);
                  console.error('[Camera Error]', payload.error);
                } else if (payload.action === 'LLM_VERDICT') {
                  console.log('[Gemma Verdict]', payload.verdict);
                } else if (payload.action === 'LLM_UNAVAILABLE' || payload.action === 'LLM_ERROR') {
                  console.warn('[LLM]', payload.reason || payload.error);
                } else if (payload.action === 'IDENTITY_MODELS_READY') {
                  setIdentityModelsReady(true);
                  setIdentityModelsFailed(false);
                } else if (payload.action === 'IDENTITY_MODELS_FAILED') {
                  setIdentityModelsFailed(true);
                  console.warn('[Identity]', payload.error);
                } else if (payload.action === 'ENROLL_DONE') {
                  setOperatorEnrolled(true);
                } else if (payload.action === 'ENROLL_FAILED') {
                  setOperatorEnrolled(false);
                  console.warn('[Enroll Failed]', payload.error);
                }
              } catch (e) {
                console.error('[Bridge Frame Error]', e);
              }
            }}
          />

          {/* Yellow HUD Reticle Overlay */}
          <View style={styles.hudOverlay} pointerEvents="none">
            <View style={styles.sensorPill}>
              <View style={styles.sensorDot} />
              <Text style={styles.sensorText}>
                {activeFacing === 'environment' ? 'DESK SENSOR (WIDE)' : 'OPERATOR SENSOR (DOCK)'}
              </Text>
            </View>
            <View style={[styles.reticle, status === 'LOCKDOWN' ? styles.reticleRed : (status === 'AWAY' ? styles.reticleAmber : styles.reticleYellow)]} />
          </View>
        </View>

        {/* Bottom Cyber-Yellow Deck */}
        <View style={styles.controlPanel}>
          {/* Status Header */}
          <View style={styles.statusRow}>
            <View>
              <Text style={styles.statusSubTitle}>SYSTEM INTEGRITY</Text>
              <Text style={[styles.statusTitle, status === 'LOCKDOWN' ? styles.threatText : (status === 'AWAY' ? styles.awayText : styles.safeText)]}>
                {status === 'LOCKDOWN' ? '● THREAT ENGAGED' : (status === 'AWAY' ? '● DESK ABANDONED' : '● PERIMETER SECURE')}
              </Text>
            </View>
            <View style={[styles.pillBadge, connected ? styles.badgeConnected : styles.badgeDisconnected]}>
              <View style={[styles.dot, connected ? styles.dotYellow : styles.dotRed]} />
              <Text style={styles.badgeText}>{connected ? 'PORT 8000' : 'OFFLINE'}</Text>
            </View>
          </View>

          <Text style={[styles.reasonText, status === 'LOCKDOWN' && styles.threatText, status === 'AWAY' && styles.awayText]}>{reason}</Text>

          {/* Rounded Camera Switcher */}
          <View style={styles.switchDeck}>
            <TouchableOpacity
              style={[
                styles.roundTab,
                activeFacing === 'environment' && styles.roundTabActive,
                isSwitching && styles.tabDisabled,
              ]}
              onPress={() => switchCamera('environment')}
              disabled={isSwitching}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabLabel, activeFacing === 'environment' && styles.tabLabelActive]}>
                Rear Lens
              </Text>
              <Text style={styles.tabSub}>Flat on Desk</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roundTab,
                activeFacing === 'user' && styles.roundTabActive,
                isSwitching && styles.tabDisabled,
              ]}
              onPress={() => switchCamera('user')}
              disabled={isSwitching}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabLabel, activeFacing === 'user' && styles.tabLabelActive]}>
                Front Lens
              </Text>
              <Text style={styles.tabSub}>Docked Upright</Text>
            </TouchableOpacity>
          </View>

          {/* Pill-Shaped Face Lock Enrollment Button */}
          <TouchableOpacity
            style={[
              styles.enrollButton,
              operatorEnrolled && styles.enrollButtonDone,
              identityModelsFailed && styles.enrollButtonFailed,
            ]}
            onPress={identityModelsFailed ? retryIdentityModelLoad : enrollOperatorFace}
            disabled={!identityModelsReady && !identityModelsFailed}
            activeOpacity={0.8}
          >
            <Text style={[styles.enrollButtonText, operatorEnrolled && styles.enrollTextDone]}>
              {identityModelsFailed
                ? '⚠ Face model failed — Tap to retry'
                : !identityModelsReady
                ? 'Loading face model…'
                : operatorEnrolled
                ? '✓ Face-Locked — Re-enroll'
                : 'Enroll My Face (Selfie)'}
            </Text>
          </TouchableOpacity>

          {/* Rounded Metrics Box */}
          <View style={styles.metricsBox}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>VISION ENGINE</Text>
              <Text style={styles.metricValue}>FaceMesh Eye-Gaze</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>INTERCEPTIONS</Text>
              <Text style={[styles.metricValue, { color: '#FACC15' }]}>{interceptions} Events</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>SUBSYSTEM</Text>
              <Text style={styles.metricValue}>{isSwitching ? 'SYNCING...' : 'REAL-TIME'}</Text>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
  container: { flex: 1, backgroundColor: '#000000' },
  cameraFrame: {
    flex: 0.55,
    position: 'relative',
    margin: 12,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#27272A',
  },
  webview: { flex: 1, backgroundColor: '#000000' },
  hudOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  sensorPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(9, 9, 11, 0.90)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#FACC15',
    gap: 6,
  },
  sensorDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FACC15' },
  sensorText: { color: '#FACC15', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  reticle: {
    width: 170,
    height: 170,
    borderWidth: 2,
    borderRadius: 24,
    borderStyle: 'dashed',
  },
  reticleYellow: { borderColor: '#FACC15' },
  reticleRed: { borderColor: '#EF4444' },
  reticleAmber: { borderColor: '#F59E0B' },
  controlPanel: {
    flex: 0.45,
    backgroundColor: '#09090B',
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    padding: 20,
    justifyContent: 'space-between',
    borderTopWidth: 1.5,
    borderColor: '#27272A',
  },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusSubTitle: { color: '#71717A', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  statusTitle: { fontSize: 19, fontWeight: '900', letterSpacing: 0.5, marginTop: 2 },
  safeText: { color: '#FACC15' },
  threatText: { color: '#EF4444' },
  awayText: { color: '#F59E0B' },
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
    gap: 6,
  },
  badgeConnected: { backgroundColor: 'rgba(250, 204, 21, 0.12)', borderWidth: 1, borderColor: '#FACC15' },
  badgeDisconnected: { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderWidth: 1, borderColor: '#EF4444' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotYellow: { backgroundColor: '#FACC15' },
  dotRed: { backgroundColor: '#EF4444' },
  badgeText: { color: '#E4E4E7', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  reasonText: { color: '#A1A1AA', fontSize: 12, marginVertical: 2 },
  switchDeck: { flexDirection: 'row', gap: 10, marginVertical: 4 },
  roundTab: {
    flex: 1,
    backgroundColor: '#18181B',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#27272A',
    alignItems: 'center',
  },
  roundTabActive: {
    borderColor: '#FACC15',
    backgroundColor: '#000000',
    shadowColor: '#FACC15',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  tabDisabled: { opacity: 0.4 },
  tabLabel: { color: '#71717A', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  tabLabelActive: { color: '#FACC15' },
  tabSub: { color: '#52525B', fontSize: 10, marginTop: 2 },
  enrollButton: {
    backgroundColor: '#18181B',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: '#27272A',
    alignItems: 'center',
    marginVertical: 4,
  },
  enrollButtonDone: { borderColor: '#FACC15', backgroundColor: '#000000' },
  enrollButtonFailed: { borderColor: '#F59E0B', backgroundColor: '#1C1917' },
  enrollButtonText: { color: '#A1A1AA', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  enrollTextDone: { color: '#FACC15' },
  metricsBox: {
    backgroundColor: '#000000',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#27272A',
    gap: 4,
  },
  metricItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { color: '#71717A', fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
  metricValue: { color: '#E4E4E7', fontSize: 10, fontWeight: '800', fontFamily: 'monospace' },
});