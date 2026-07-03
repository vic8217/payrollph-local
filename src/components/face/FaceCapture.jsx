import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function FaceCapture({
  onCapture,
  onLivenessDetected,
  onReset,
  disabled = false,
  autoStart = false,
  autoCaptureOnLiveness = false,
  onBeforeStart,
  onErrorChange,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const livenessTimerRef = useRef(null);
  const previousFrameRef = useRef(null);
  const livenessStartedAtRef = useRef(0);
  const cameraStartedAtRef = useRef(0);
  const livenessDetectedAtRef = useRef(0);
  const capturedRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const samplingRef = useRef(false);
  const faceDetectorRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [livenessStatus, setLivenessStatus] = useState('idle');

  const updateError = (message) => {
    setError(message);
    onErrorChange?.(message);
  };

  const getFaceGuideBox = (video) => {
    const width = video.videoWidth || 320;
    const height = video.videoHeight || 240;
    const displayWidth = video.clientWidth || width;
    const displayHeight = video.clientHeight || height;
    const scale = Math.max(displayWidth / width, displayHeight / height);
    const visibleWidth = displayWidth / scale;
    const visibleHeight = displayHeight / scale;
    const sourceOffsetX = (width - visibleWidth) / 2;
    const sourceOffsetY = (height - visibleHeight) / 2;
    const guideDisplayWidth = displayWidth * 0.46;
    const guideDisplayHeight = displayHeight * 0.72;
    const guideWidth = guideDisplayWidth / scale;
    const guideHeight = guideDisplayHeight / scale;
    return {
      x: sourceOffsetX + ((displayWidth - guideDisplayWidth) / 2) / scale,
      y: sourceOffsetY + ((displayHeight - guideDisplayHeight) / 2) / scale,
      width: guideWidth,
      height: guideHeight,
    };
  };

  const getFaceDetector = () => {
    if (typeof window === 'undefined' || !('FaceDetector' in window)) return null;
    if (!faceDetectorRef.current) {
      faceDetectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
    }
    return faceDetectorRef.current;
  };

  const readGuideFrame = (video, canvasWidth = 96, canvasHeight = 128) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const guide = getFaceGuideBox(video);
    context.drawImage(video, guide.x, guide.y, guide.width, guide.height, 0, 0, canvas.width, canvas.height);
    return {
      data: context.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width,
      height: canvas.height,
    };
  };

  const isSkinLikePixel = (red, green, blue) => {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (red < 45 || green < 30 || blue < 18 || max - min < 12) return false;
    const y = 0.299 * red + 0.587 * green + 0.114 * blue;
    const cb = 128 - 0.168736 * red - 0.331264 * green + 0.5 * blue;
    const cr = 128 + 0.5 * red - 0.418688 * green - 0.081312 * blue;
    return y > 45 && cb >= 75 && cb <= 145 && cr >= 125 && cr <= 185;
  };

  const validateFaceLikeRegionInsideGuide = (video) => {
    const frame = readGuideFrame(video, 96, 128);
    const gray = new Uint8Array(frame.width * frame.height);
    let skinPixels = 0;
    let centralSkinPixels = 0;
    let minSkinX = frame.width;
    let minSkinY = frame.height;
    let maxSkinX = 0;
    let maxSkinY = 0;

    for (let index = 0, pixel = 0; index < frame.data.length; index += 4, pixel += 1) {
      const red = frame.data[index];
      const green = frame.data[index + 1];
      const blue = frame.data[index + 2];
      const x = pixel % frame.width;
      const y = Math.floor(pixel / frame.width);
      gray[pixel] = Math.round((red + green + blue) / 3);
      if (isSkinLikePixel(red, green, blue)) {
        skinPixels += 1;
        minSkinX = Math.min(minSkinX, x);
        minSkinY = Math.min(minSkinY, y);
        maxSkinX = Math.max(maxSkinX, x);
        maxSkinY = Math.max(maxSkinY, y);
        if (
          x > frame.width * 0.2 &&
          x < frame.width * 0.8 &&
          y > frame.height * 0.12 &&
          y < frame.height * 0.74
        ) {
          centralSkinPixels += 1;
        }
      }
    }

    const totalPixels = frame.width * frame.height;
    const skinRatio = skinPixels / totalPixels;
    const centralSkinRatio = centralSkinPixels / totalPixels;
    const skinBoxWidth = maxSkinX > minSkinX ? (maxSkinX - minSkinX) / frame.width : 0;
    const skinBoxHeight = maxSkinY > minSkinY ? (maxSkinY - minSkinY) / frame.height : 0;

    let edgePixels = 0;
    let straightEdgeRows = 0;
    let straightEdgeColumns = 0;
    for (let y = 2; y < frame.height - 2; y += 1) {
      let rowEdges = 0;
      for (let x = 2; x < frame.width - 2; x += 1) {
        const horizontal = Math.abs(gray[y * frame.width + x - 1] - gray[y * frame.width + x + 1]);
        const vertical = Math.abs(gray[(y - 1) * frame.width + x] - gray[(y + 1) * frame.width + x]);
        if (horizontal + vertical > 95) {
          edgePixels += 1;
          rowEdges += 1;
        }
      }
      if (rowEdges / frame.width > 0.36) straightEdgeRows += 1;
    }
    for (let x = 2; x < frame.width - 2; x += 1) {
      let columnEdges = 0;
      for (let y = 2; y < frame.height - 2; y += 1) {
        const horizontal = Math.abs(gray[y * frame.width + x - 1] - gray[y * frame.width + x + 1]);
        const vertical = Math.abs(gray[(y - 1) * frame.width + x] - gray[(y + 1) * frame.width + x]);
        if (horizontal + vertical > 95) columnEdges += 1;
      }
      if (columnEdges / frame.height > 0.34) straightEdgeColumns += 1;
    }

    const edgeRatio = edgePixels / totalPixels;
    const hasPhotoLikeEdges = edgeRatio > 0.18 || (straightEdgeRows >= 2 && straightEdgeColumns >= 2);
    if (hasPhotoLikeEdges && centralSkinRatio < 0.11) {
      return { ok: false, message: 'Phone or photo edges detected. Use a live face, not a picture.' };
    }

    if (skinRatio < 0.1 || centralSkinRatio < 0.055 || skinBoxWidth < 0.34 || skinBoxHeight < 0.28) {
      return { ok: false, message: 'Move closer and center your live face inside the guide.' };
    }

    return { ok: true, message: '' };
  };

  const validateWholeFaceInsideGuide = async (video) => {
    const width = video.videoWidth || 320;
    const height = video.videoHeight || 240;
    if (!width || !height) {
      return { ok: false, message: 'Camera is still starting.' };
    }

    const detector = getFaceDetector();
    if (!detector) {
      return validateFaceLikeRegionInsideGuide(video);
    }

    let faces = [];
    try {
      faces = await detector.detect(video);
    } catch {
      return validateFaceLikeRegionInsideGuide(video);
    }

    if (faces.length !== 1) {
      return {
        ok: false,
        message: faces.length > 1 ? 'Only one face must be inside the guide.' : 'Place your face inside the guide.',
      };
    }

    const face = faces[0].boundingBox;
    const guide = getFaceGuideBox(video);
    const faceCenterX = face.x + face.width / 2;
    const faceCenterY = face.y + face.height / 2;
    const insideGuide =
      face.x >= guide.x - guide.width * 0.08 &&
      face.y >= guide.y - guide.height * 0.08 &&
      face.x + face.width <= guide.x + guide.width * 1.08 &&
      face.y + face.height <= guide.y + guide.height * 1.08 &&
      faceCenterX >= guide.x &&
      faceCenterX <= guide.x + guide.width &&
      faceCenterY >= guide.y &&
      faceCenterY <= guide.y + guide.height;
    if (!insideGuide) {
      return { ok: false, message: 'Keep your whole face inside the guide.' };
    }

    if (face.width < guide.width * 0.36 || face.height < guide.height * 0.3) {
      return { ok: false, message: 'Move closer so your live face fills the guide.' };
    }

    return { ok: true, message: '' };
  };

  const detectScreenPresentation = (video) => {
    const width = video.videoWidth || 320;
    const height = video.videoHeight || 240;
    if (!width || !height) return false;

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 72;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
      gray[pixel] = Math.round((data[index] + data[index + 1] + data[index + 2]) / 3);
    }

    const verticalEdges = [];
    for (let x = 6; x < canvas.width - 6; x += 1) {
      let strong = 0;
      let darkSide = 0;
      let samples = 0;
      for (let y = 8; y < canvas.height - 8; y += 1) {
        const left = gray[y * canvas.width + x - 1];
        const right = gray[y * canvas.width + x + 1];
        if (Math.abs(left - right) > 55) strong += 1;
        if (left < 55 || right < 55) darkSide += 1;
        samples += 1;
      }
      if (strong / samples > 0.42 && darkSide / samples > 0.22) verticalEdges.push(x);
    }

    const horizontalEdges = [];
    for (let y = 6; y < canvas.height - 6; y += 1) {
      let strong = 0;
      let darkSide = 0;
      let samples = 0;
      for (let x = 8; x < canvas.width - 8; x += 1) {
        const top = gray[(y - 1) * canvas.width + x];
        const bottom = gray[(y + 1) * canvas.width + x];
        if (Math.abs(top - bottom) > 55) strong += 1;
        if (top < 55 || bottom < 55) darkSide += 1;
        samples += 1;
      }
      if (strong / samples > 0.38 && darkSide / samples > 0.18) horizontalEdges.push(y);
    }

    const hasVerticalPair = verticalEdges.some((left, index) =>
      verticalEdges.slice(index + 1).some(right => right - left > canvas.width * 0.28 && right - left < canvas.width * 0.78)
    );
    const hasHorizontalPair = horizontalEdges.some((top, index) =>
      horizontalEdges.slice(index + 1).some(bottom => bottom - top > canvas.height * 0.25 && bottom - top < canvas.height * 0.8)
    );

    let centerDarkFrame = 0;
    let centerSamples = 0;
    for (let y = 10; y < canvas.height - 10; y += 1) {
      for (let x = 10; x < canvas.width - 10; x += 1) {
        const nearPhoneSide =
          verticalEdges.some(edgeX => Math.abs(edgeX - x) <= 2) ||
          horizontalEdges.some(edgeY => Math.abs(edgeY - y) <= 2);
        if (nearPhoneSide) {
          centerSamples += 1;
          if (gray[y * canvas.width + x] < 70) centerDarkFrame += 1;
        }
      }
    }

    return hasVerticalPair && (hasHorizontalPair || (centerSamples > 0 && centerDarkFrame / centerSamples > 0.22));
  };

  const stopCamera = ({ resetState = true } = {}) => {
    if (livenessTimerRef.current) {
      clearInterval(livenessTimerRef.current);
      livenessTimerRef.current = null;
    }
    streamRef.current?.getTracks?.().forEach(track => track.stop());
    streamRef.current = null;
    cameraReadyRef.current = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (resetState) setCameraReady(false);
  };

  const sampleFaceGuideMotion = async () => {
    const video = videoRef.current;
    if (!video || !cameraReadyRef.current || preview || capturedRef.current) return;
    if (samplingRef.current) return;
    samplingRef.current = true;
    if (detectScreenPresentation(video)) {
      capturedRef.current = true;
      setLivenessStatus('spoof');
      updateError('Possible phone or screen photo detected. Use a live face, not a picture.');
      samplingRef.current = false;
      return;
    }
    const faceGuide = await validateWholeFaceInsideGuide(video);
    if (!faceGuide.ok) {
      previousFrameRef.current = null;
      setLivenessStatus('align');
      updateError(faceGuide.message);
      samplingRef.current = false;
      return;
    }
    if (error) updateError('');
    const width = video.videoWidth || 320;
    const height = video.videoHeight || 240;
    if (!width || !height) {
      samplingRef.current = false;
      return;
    }

    const guideFrame = readGuideFrame(video, 72, 96);
    const frame = new Uint8Array(guideFrame.width * guideFrame.height);
    for (let index = 0, pixel = 0; index < guideFrame.data.length; index += 4, pixel += 1) {
      frame[pixel] = Math.round((guideFrame.data[index] + guideFrame.data[index + 1] + guideFrame.data[index + 2]) / 3);
    }

    const previous = previousFrameRef.current;
    previousFrameRef.current = frame;
    if (!previous) {
      samplingRef.current = false;
      return;
    }
    if (Date.now() - livenessStartedAtRef.current < 1400) {
      samplingRef.current = false;
      return;
    }

    let diff = 0;
    let activePixels = 0;
    for (let index = 0; index < frame.length; index += 1) {
      const delta = Math.abs(frame[index] - previous[index]);
      diff += delta;
      if (delta > 18) activePixels += 1;
    }
    const motionScore = diff / frame.length;
    const activeMotionRatio = activePixels / frame.length;
    if (motionScore > 7.5 && motionScore < 34 && activeMotionRatio > 0.025 && activeMotionRatio < 0.24) {
      capturedRef.current = true;
      livenessDetectedAtRef.current = Date.now();
      setLivenessStatus('detected');
      onLivenessDetected?.();
      if (autoCaptureOnLiveness) {
        setTimeout(() => capture(), 250);
      }
    }
    samplingRef.current = false;
  };

  const startLivenessDetection = () => {
    if (!autoCaptureOnLiveness) return;
    if (livenessTimerRef.current) clearInterval(livenessTimerRef.current);
    previousFrameRef.current = null;
    capturedRef.current = false;
    livenessStartedAtRef.current = Date.now();
    setLivenessStatus('watching');
    livenessTimerRef.current = setInterval(sampleFaceGuideMotion, 180);
  };

  const startCamera = async () => {
    stopCamera();
    updateError('');
    setPreview('');
    setLivenessStatus('idle');
    capturedRef.current = false;
    livenessDetectedAtRef.current = 0;
    onReset?.();
    try {
      await onBeforeStart?.();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } },
        audio: false,
      });
      streamRef.current = stream;
      cameraStartedAtRef.current = Date.now();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      cameraReadyRef.current = true;
      setCameraReady(true);
      setTimeout(startLivenessDetection, 250);
    } catch (startError) {
      const message = startError?.name === 'NotReadableError'
        ? 'Camera is already in use. Close other camera apps or restart the camera.'
        : 'Camera access is required for face verification.';
      updateError(message);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !cameraReadyRef.current) return;
    if (detectScreenPresentation(video)) {
      setLivenessStatus('spoof');
      updateError('Possible phone or screen photo detected. Use a live face, not a picture.');
      return;
    }
    const faceGuide = await validateWholeFaceInsideGuide(video);
    if (!faceGuide.ok) {
      setLivenessStatus('align');
      updateError(faceGuide.message);
      capturedRef.current = false;
      startLivenessDetection();
      return;
    }
    if (livenessTimerRef.current) {
      clearInterval(livenessTimerRef.current);
      livenessTimerRef.current = null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.86);
    const capturedAt = Date.now();
    setPreview(imageBase64);
    onCapture?.(imageBase64, {
      source: 'webcam',
      cameraStartedAt: cameraStartedAtRef.current,
      livenessDetectedAt: livenessDetectedAtRef.current || capturedAt,
      capturedAt,
      width: canvas.width,
      height: canvas.height,
    });
  };

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (autoStart) startCamera();
    return undefined;
  }, [autoStart]);

  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-muted">
        {preview ? (
          <img src={preview} alt="Captured face preview" className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        )}
        {!preview && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[72%] w-[46%] min-w-40 rounded-[42%] border-2 border-emerald-400/90 shadow-[0_0_0_999px_rgba(15,23,42,0.22)]">
              <div className="absolute -left-1 -top-1 h-8 w-8 border-l-4 border-t-4 border-white" />
              <div className="absolute -right-1 -top-1 h-8 w-8 border-r-4 border-t-4 border-white" />
              <div className="absolute -bottom-1 -left-1 h-8 w-8 border-b-4 border-l-4 border-white" />
              <div className="absolute -bottom-1 -right-1 h-8 w-8 border-b-4 border-r-4 border-white" />
            </div>
            <div className="absolute bottom-3 rounded-md bg-slate-950/70 px-3 py-1 text-xs text-white">
              {autoCaptureOnLiveness
                ? livenessStatus === 'spoof'
                  ? 'Phone or screen photo detected'
                  : livenessStatus === 'align'
                  ? 'Keep your whole face inside the guide'
                  : livenessStatus === 'detected'
                  ? 'Liveness detected. Capturing...'
                  : 'Center your full face, then blink'
                : 'Align the full face inside the guide'}
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={startCamera} disabled={disabled}>
          <Camera className="mr-2 h-4 w-4" />
          {cameraReady ? 'Restart Camera' : 'Start Camera'}
        </Button>
        {!autoCaptureOnLiveness && (
          <Button type="button" onClick={capture} disabled={disabled || !cameraReady}>
            <Square className="mr-2 h-4 w-4" />
            Capture
          </Button>
        )}
        {preview && (
          <Button type="button" variant="ghost" onClick={startCamera} disabled={disabled}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retake
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {autoCaptureOnLiveness
          ? 'The system waits for one whole face inside the guide, then watches for a blink or slight head movement before capturing.'
          : 'Use a live camera capture after blinking or turning your head slightly. Uploads are not accepted.'}
      </p>
    </div>
  );
}
