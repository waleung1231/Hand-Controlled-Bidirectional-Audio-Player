// ========== HAND RECOGNITION VARIABLES ==========
const SMOOTHING_WINDOW = 5;
const SPEED_CALCULATION_FRAMES = 10;

let hands, camera;
let previousAngles = [];
let rotationHistory = [];
let frameTimestamps = [];
let currentRotation = 'none';
let totalRotation = 0;
let rotationVelocity = 0;
let lastGestureTime = 0;
let gestureCooldown = 1000;
let lastHandDetectedTime = Date.now();
let lastActiveRotationTime = Date.now();
let handDetectionTimeout = 2000;
let handTimeoutTimer = null;
let isFingerDetected = false;

// Control mode variables
let controlMode = 'distance'; // 'distance' or 'speed'
let velocityHistory = [];
let fingerVelocity = 0;

// DOM elements for hand recognition
const videoElement = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');
const rotationText = document.getElementById('rotationText');
const currentDirection = document.getElementById('currentDirection');
const angleDisplay = document.getElementById('angleDisplay');
const speedDisplay = document.getElementById('speedDisplay');
const fingerStatus = document.getElementById('fingerStatus');
const detectionStatus = document.getElementById('detectionStatus');
const loadingMessage = document.getElementById('loadingMessage');
const errorMessage = document.getElementById('errorMessage');
const handSection = document.getElementById('handSection');

// Control mode toggle elements
const distanceModeRadio = document.getElementById('distanceMode');
const speedModeRadio = document.getElementById('speedMode');
const distanceModeInstructions = document.getElementById('distanceModeInstructions');
const speedModeInstructions = document.getElementById('speedModeInstructions');

// ========== AUDIO PLAYER VARIABLES ==========
const params = {
    playback: {
        clickBoostActive: false,
        alpha: 0.05,
        decay: 0.9,
        clickBoostDecay: 0.999,
        asymptoticDecay: 0.5,
        speed: 1.0,
    },
    navigation: {
        segmentDuration: 2.0,
        segmentStep: 1.5,
        segmentIntervalMs: 1200,
        maxActiveSources: 3,
        fadeDuration: 0.25,
        minSpeed: -4,
        maxSpeed: 4,
    },
    filtering: {
        alphaFinger: 0.01,
        alphaNoFinger: 0.001,
        driftTarget: 0.7,
        gestureAmplitude: 1.0,
    },
};

// Global variables for audio
let audioContext;
let audioBuffer;
let currentSource = null;
let isPlaying = false;
let manuallyPaused = false; // Flag to prevent hand tracking from overriding pause
let navigationSpeed = 1.0;
let filteredSpeed = 1.0;
let gestureTarget = 0.7;
let filterAnimationFrame = null;
let startTime = 0;
let pauseTime = 0;
let animationFrame = null;
let scheduleTimeout = null;
let speedSmoothingHandle = null;
const speedState = {
    target: navigationSpeed,
    current: navigationSpeed,
    velocity: 0,
    boost: 0,
};
const activeSources = new Set();
let prevNavigationSpeed = 1.0;

// DOM elements for audio player
const audioFileInput = document.getElementById('audioFile');
const htmlAudioElement = document.getElementById('htmlAudioElement');
const controls = document.getElementById('controls');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const seekBar = document.getElementById('seekBar');
const speedBar = document.getElementById('speedBar');
const speedValue = document.getElementById('speedValue');
const filteredSpeedBar = document.getElementById('filteredSpeedBar');
const filteredSpeedValue = document.getElementById('filteredSpeedValue');
const currentTimeDisplay = document.getElementById('currentTime');
const durationDisplay = document.getElementById('duration');
const loadDefaultBtn = document.getElementById('loadDefaultBtn');

// Alpha control elements
const alphaFingerInput = document.getElementById('alphaFingerInput');
const alphaFingerValue = document.getElementById('alphaFingerValue');
const alphaNoFingerInput = document.getElementById('alphaNoFingerInput');
const alphaNoFingerValue = document.getElementById('alphaNoFingerValue');
const driftTargetInput = document.getElementById('driftTargetInput');
const driftTargetValue = document.getElementById('driftTargetValue');
const activeAlphaDisplay = document.getElementById('activeAlphaDisplay');
const alphaStateText = document.getElementById('alphaStateText');

// Parameter control elements
const segmentDurationInput = document.getElementById('segmentDuration');
const segmentStepInput = document.getElementById('segmentStep');
const segmentIntervalInput = document.getElementById('segmentInterval');
const fadeDurationInput = document.getElementById('fadeDuration');
const effectiveStepDisplay = document.getElementById('effectiveStep');
const effectiveIntervalDisplay = document.getElementById('effectiveInterval');

const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16.0;

// ========== HAND RECOGNITION FUNCTIONS ==========
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    loadingMessage.style.display = 'none';
    console.error(message);
}

function hideLoading() {
    loadingMessage.style.display = 'none';
    handSection.style.display = 'block';
}

async function initializeHands() {
    try {
        console.log("Initializing MediaPipe Hands...");
        
        if (typeof Hands === 'undefined') {
            throw new Error('MediaPipe Hands library failed to load. Please check your internet connection.');
        }

        hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7
        });

        hands.onResults(onResults);

        console.log("MediaPipe Hands initialized, starting camera...");

        if (typeof Camera === 'undefined') {
            throw new Error('MediaPipe Camera utility failed to load.');
        }

        camera = new Camera(videoElement, {
            onFrame: async () => {
                await hands.send({image: videoElement});
            },
            width: 640,
            height: 480
        });

        await camera.start();
        console.log("Camera started successfully!");
        hideLoading();

    } catch (error) {
        console.error('Initialization error:', error);
        showError(`Error: ${error.message}. Please refresh the page and try again.`);
    }
}

function onResults(results) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        isFingerDetected = true;
        lastHandDetectedTime = Date.now();
        
        if (handTimeoutTimer) {
            clearTimeout(handTimeoutTimer);
            handTimeoutTimer = null;
        }
        
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS,
            {color: 'rgba(255, 255, 255, 0.3)', lineWidth: 2});
        drawLandmarks(canvasCtx, landmarks,
            {color: 'rgba(255, 255, 255, 0.5)', lineWidth: 1, radius: 2});
        
        highlightIndexFinger(landmarks);

        // Dispatch to the appropriate control mode
        if (controlMode === 'distance') {
            detectIndexFingerRotation(landmarks);
        } else {
            detectFingerVelocity(landmarks);
        }
    } else {
        isFingerDetected = false;
        fingerStatus.textContent = '❌';
        resetRotationState();
        
        setGestureTargetForDrift();
        
        if (!filterAnimationFrame) {
            updateFilteredSpeed();
        }
        
        if (!handTimeoutTimer) {
            handTimeoutTimer = setTimeout(() => {
                handTimeoutTimer = null;
            }, handDetectionTimeout);
        }
    }
    
    canvasCtx.restore();
}

function highlightIndexFinger(landmarks) {
    const indexTip = landmarks[8];

    canvasCtx.beginPath();
    canvasCtx.fillStyle = '#00ff00';
    canvasCtx.arc(
        indexTip.x * canvasElement.width,
        indexTip.y * canvasElement.height,
        10,
        0,
        2 * Math.PI
    );
    canvasCtx.fill();
    
    fingerStatus.textContent = '✅';
}

function detectIndexFingerRotation(landmarks) {
    const indexTip = landmarks[8];
    const currentPos = { x: indexTip.x, y: indexTip.y };
    
    const MIN_MOVEMENT = 0.015;
    
    if (previousAngles.length > 0) {
        const lastPos = previousAngles[previousAngles.length - 1];
        const dx = currentPos.x - lastPos.x;
        const dy = currentPos.y - lastPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < MIN_MOVEMENT) {
            // Hand detected but not moving - keep input stable, let filtered catch up
            if (!manuallyPaused) {
                gestureTarget = navigationSpeed;
            }
            // Reset rotation speed display to 0
            speedDisplay.textContent = '0°/s';
            rotationVelocity = 0;
            if (!filterAnimationFrame && !manuallyPaused) {
                updateFilteredSpeed();
            }
            return;
        }
    }
    
    previousAngles.push(currentPos);
    frameTimestamps.push(Date.now());
    
    if (previousAngles.length > SMOOTHING_WINDOW) {
        previousAngles.shift();
        frameTimestamps.shift();
    }
    
    if (previousAngles.length < 3) return;
    
    let totalAngularVelocity = 0;
    let validSamples = 0;
    
    for (let i = 2; i < previousAngles.length; i++) {
        const p0 = previousAngles[i - 2];
        const p1 = previousAngles[i - 1];
        const p2 = previousAngles[i];
        
        const v1x = p1.x - p0.x;
        const v1y = p1.y - p0.y;
        const v2x = p2.x - p1.x;
        const v2y = p2.y - p1.y;
        
        const crossProduct = v1x * v2y - v1y * v2x;
        
        const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
        const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
        
        if (mag1 > 0.01 && mag2 > 0.01) {
            const angularChange = crossProduct / (mag1 * mag2);
            totalAngularVelocity += angularChange;
            validSamples++;
        }
    }
    
    if (validSamples === 0) {
        speedDisplay.textContent = '0°/s';
        rotationVelocity = 0;
        setGestureTargetForDrift();
        if (!filterAnimationFrame) {
            updateFilteredSpeed();
        }
        return;
    }
    
    const avgAngularVelocity = totalAngularVelocity / validSamples;
    
    rotationHistory.push(avgAngularVelocity);
    if (rotationHistory.length > SPEED_CALCULATION_FRAMES) {
        rotationHistory.shift();
    }
    
    if (frameTimestamps.length >= 2) {
        const timeDiff = (frameTimestamps[frameTimestamps.length - 1] - 
                        frameTimestamps[0]) / 1000;
        
        if (timeDiff > 0) {
            // avgAngularVelocity is already the current frame's angular change
            // Just scale it for display as degrees per second
            const frameDuration = timeDiff / (frameTimestamps.length - 1);
            rotationVelocity = avgAngularVelocity / frameDuration;
            
            const VELOCITY_SCALE = 1000;
            const displaySpeed = Math.abs(rotationVelocity) * VELOCITY_SCALE;
            speedDisplay.textContent = `${Math.round(displaySpeed)}°/s`;
            
            totalRotation += avgAngularVelocity * 180 / Math.PI;
            angleDisplay.textContent = `${Math.round(totalRotation)}°`;
            
            if (Math.abs(rotationVelocity) > 0.12) {
                lastActiveRotationTime = Date.now();
                if (rotationVelocity < 0) {
                    setRotation('clockwise');
                    setGestureTargetFromRotation(1);
                } else {
                    setRotation('counterclockwise');
                    setGestureTargetFromRotation(-1);
                }
                
                if (!filterAnimationFrame) {
                    updateFilteredSpeed();
                }
            } else {
                // Rotation is very small but hand is still detected - keep input stable, let filtered catch up
                if (!manuallyPaused) {
                    gestureTarget = navigationSpeed;
                }
                speedDisplay.textContent = '0°/s';
                rotationVelocity = 0;
                if (!filterAnimationFrame && !manuallyPaused) {
                    updateFilteredSpeed();
                }
            }
        }
    }
    
    const recentTrend = rotationHistory.slice(-5).reduce((sum, val) => sum + val, 0);
    const DIRECTION_THRESHOLD = 0.08;
    
    if (Math.abs(recentTrend) > DIRECTION_THRESHOLD) {
        if (recentTrend > 0) {
            setRotation('counterclockwise');
        } else {
            setRotation('clockwise');
        }
    }
}

function setGestureTargetFromRotation(direction) {
    // Don't update speed if manually paused
    if (manuallyPaused) return;

    const speedIncrement = 0.05;
    const maxSpeed = params.navigation.maxSpeed;
    const minSpeed = params.navigation.minSpeed;

    if (direction > 0) {
        navigationSpeed = Math.min(navigationSpeed + speedIncrement, maxSpeed);
    } else {
        navigationSpeed = Math.max(navigationSpeed - speedIncrement, minSpeed);
    }

    speedBar.value = navigationSpeed;
    speedValue.textContent = navigationSpeed.toFixed(2);

    gestureTarget = navigationSpeed;
}

function setGestureTargetForDrift() {
    // Don't update speed if manually paused
    if (manuallyPaused) return;

    // Speed mode always drifts to 1x (normal playback)
    // Distance mode drifts to the configured drift target
    if (controlMode === 'speed') {
        gestureTarget = 1.0;
    } else {
        if (filteredSpeed > 0) {
            // Set drift target - navigationSpeed will gradually follow filteredSpeed
            gestureTarget = params.filtering.driftTarget;
        } else {
            // For negative speeds, maintain current speed (no drift)
            gestureTarget = filteredSpeed;
        }
    }

    // Update navigationSpeed to follow filteredSpeed (the smoothed output)
    // This makes the input slider track the actual playback speed
    navigationSpeed = filteredSpeed;
    speedBar.value = navigationSpeed;
    speedValue.textContent = navigationSpeed.toFixed(2);
}

// ========== SPEED MODE: Rotational Velocity Detection ==========
function detectFingerVelocity(landmarks) {
    const indexTip = landmarks[8];
    const currentPos = { x: indexTip.x, y: indexTip.y };

    const MIN_MOVEMENT = 0.015;

    if (previousAngles.length > 0) {
        const lastPos = previousAngles[previousAngles.length - 1];
        const dx = currentPos.x - lastPos.x;
        const dy = currentPos.y - lastPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < MIN_MOVEMENT) {
            // Hand detected but not moving - drift to default speed
            if (!manuallyPaused) {
                setGestureTargetForDrift();
            }
            // Reset rotation speed display to 0
            speedDisplay.textContent = '0°/s';
            rotationVelocity = 0;
            rotationText.textContent = 'Hold Still';
            detectionStatus.style.background = 'rgba(100, 100, 100, 0.7)';
            currentDirection.innerHTML = '<span>⊙</span>';
            if (!filterAnimationFrame && !manuallyPaused) {
                updateFilteredSpeed();
            }
            return;
        }
    }

    previousAngles.push(currentPos);
    frameTimestamps.push(Date.now());

    if (previousAngles.length > SMOOTHING_WINDOW) {
        previousAngles.shift();
        frameTimestamps.shift();
    }

    if (previousAngles.length < 3) return;

    let totalAngularVelocity = 0;
    let validSamples = 0;

    for (let i = 2; i < previousAngles.length; i++) {
        const p0 = previousAngles[i - 2];
        const p1 = previousAngles[i - 1];
        const p2 = previousAngles[i];

        const v1x = p1.x - p0.x;
        const v1y = p1.y - p0.y;
        const v2x = p2.x - p1.x;
        const v2y = p2.y - p1.y;

        const crossProduct = v1x * v2y - v1y * v2x;

        const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
        const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

        if (mag1 > 0.01 && mag2 > 0.01) {
            const angularChange = crossProduct / (mag1 * mag2);
            totalAngularVelocity += angularChange;
            validSamples++;
        }
    }

    if (validSamples === 0) {
        speedDisplay.textContent = '0°/s';
        rotationVelocity = 0;
        if (!manuallyPaused) {
            setGestureTargetForDrift();
        }
        if (!filterAnimationFrame && !manuallyPaused) {
            updateFilteredSpeed();
        }
        return;
    }

    const avgAngularVelocity = totalAngularVelocity / validSamples;

    rotationHistory.push(avgAngularVelocity);
    if (rotationHistory.length > SPEED_CALCULATION_FRAMES) {
        rotationHistory.shift();
    }

    if (frameTimestamps.length >= 2) {
        const timeDiff = (frameTimestamps[frameTimestamps.length - 1] -
                        frameTimestamps[0]) / 1000;

        if (timeDiff > 0) {
            const frameDuration = timeDiff / (frameTimestamps.length - 1);
            rotationVelocity = avgAngularVelocity / frameDuration;

            const VELOCITY_SCALE = 1000;
            const displaySpeed = Math.abs(rotationVelocity) * VELOCITY_SCALE;
            speedDisplay.textContent = `${Math.round(displaySpeed)}°/s`;

            totalRotation += avgAngularVelocity * 180 / Math.PI;
            angleDisplay.textContent = `${Math.round(totalRotation)}°`;

            if (Math.abs(rotationVelocity) > 0.12) {
                lastActiveRotationTime = Date.now();
                if (rotationVelocity < 0) {
                    setRotation('clockwise');
                    if (!manuallyPaused) {
                        setGestureTargetFromRotationVelocity(rotationVelocity);
                    }
                } else {
                    setRotation('counterclockwise');
                    if (!manuallyPaused) {
                        setGestureTargetFromRotationVelocity(rotationVelocity);
                    }
                }

                if (!filterAnimationFrame && !manuallyPaused) {
                    updateFilteredSpeed();
                }
            } else {
                // Rotation is very small but hand is still detected - drift
                if (!manuallyPaused) {
                    setGestureTargetForDrift();
                }
                speedDisplay.textContent = '0°/s';
                rotationVelocity = 0;
                rotationText.textContent = 'Hold Still';
                detectionStatus.style.background = 'rgba(100, 100, 100, 0.7)';
                currentDirection.innerHTML = '<span>⊙</span>';
                if (!filterAnimationFrame && !manuallyPaused) {
                    updateFilteredSpeed();
                }
            }
        }
    }
}

function setGestureTargetFromRotationVelocity(angularVelocity) {
    // Don't update speed if manually paused
    if (manuallyPaused) return;

    // Map rotational velocity to speed
    // angularVelocity is negative for clockwise, positive for counter-clockwise
    const maxSpeed = params.navigation.maxSpeed;

    // Scale the angular velocity to control speed
    // Higher velocity = faster playback or faster reverse
    const velocityMagnitude = Math.abs(angularVelocity);
    const VELOCITY_SCALE = 8; // Reduced sensitivity - need to spin faster to reach max speed

    // Map velocity magnitude to speed magnitude (0.5 to 4)
    const speedMagnitude = clamp(velocityMagnitude * VELOCITY_SCALE, 0.5, maxSpeed);

    // Determine target speed based on rotation direction
    let targetSpeed;
    if (angularVelocity < 0) {
        // Clockwise - forward playback
        targetSpeed = speedMagnitude;
    } else {
        // Counter-clockwise - backward playback
        targetSpeed = -speedMagnitude;
    }

    // Smooth the input speed to reduce flickering
    const INPUT_SMOOTHING = 0.3; // Higher = more responsive, lower = smoother
    navigationSpeed = navigationSpeed + INPUT_SMOOTHING * (targetSpeed - navigationSpeed);

    speedBar.value = navigationSpeed;
    speedValue.textContent = navigationSpeed.toFixed(2);

    gestureTarget = navigationSpeed;
}

function setRotation(direction) {
    if (currentRotation === direction) return;

    currentRotation = direction;

    if (direction === 'clockwise') {
        rotationText.textContent = '↻ Clockwise';
        detectionStatus.style.background = 'rgba(74, 222, 128, 0.7)';
        currentDirection.innerHTML = '<span style="color: #4ade80;">↻</span>';
    } else if (direction === 'counterclockwise') {
        rotationText.textContent = '↺ Counter-clockwise';
        detectionStatus.style.background = 'rgba(248, 113, 113, 0.7)';
        currentDirection.innerHTML = '<span style="color: #f87171;">↺</span>';
    }
}

function resetRotationState() {
    currentRotation = 'none';
    rotationText.textContent = controlMode === 'distance' ? 'No Rotation' : 'Hold Still';
    detectionStatus.style.background = 'rgba(0, 0, 0, 0.7)';
    currentDirection.innerHTML = '<span>⊙</span>';
    previousAngles = [];
    rotationHistory = [];
    velocityHistory = [];
    frameTimestamps = [];
    totalRotation = 0;
    rotationVelocity = 0;
    fingerVelocity = 0;
    angleDisplay.textContent = '0°';
    speedDisplay.textContent = '0°/s';
}

// ========== AUDIO PLAYER FUNCTIONS ==========
audioContext = new (window.AudioContext || window.webkitAudioContext)();

speedBar.min = params.navigation.minSpeed;
speedBar.max = params.navigation.maxSpeed;
speedBar.value = navigationSpeed;
speedValue.textContent = navigationSpeed.toFixed(2);

segmentDurationInput.value = params.navigation.segmentDuration;
segmentStepInput.value = params.navigation.segmentStep;
segmentIntervalInput.value = params.navigation.segmentIntervalMs;
fadeDurationInput.value = params.navigation.fadeDuration;
updateEffectiveParams();

audioFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    stopPlayback();

    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const fileURL = URL.createObjectURL(file);
    htmlAudioElement.src = fileURL;
    htmlAudioElement.preservesPitch = true;
    htmlAudioElement.mozPreservesPitch = true;
    htmlAudioElement.webkitPreservesPitch = true;

    seekBar.max = audioBuffer.duration;
    seekBar.value = 0;
    pauseTime = 0;

    durationDisplay.textContent = formatTime(audioBuffer.duration);
    currentTimeDisplay.textContent = formatTime(0);

    controls.style.display = 'block';
});

loadDefaultBtn.addEventListener('click', async () => {
    stopPlayback();
    audioFileInput.value = '';

    try {
        const audioUrl = './around-the-world-in-80-days-chapter-10.mp3';
        
        htmlAudioElement.src = audioUrl;
        htmlAudioElement.preservesPitch = true;
        htmlAudioElement.mozPreservesPitch = true;
        htmlAudioElement.webkitPreservesPitch = true;

        await new Promise((resolve, reject) => {
            htmlAudioElement.onloadedmetadata = resolve;
            htmlAudioElement.onerror = reject;
        });

        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        seekBar.max = audioBuffer.duration;
        seekBar.value = 0;
        pauseTime = 0;

        durationDisplay.textContent = formatTime(audioBuffer.duration);
        currentTimeDisplay.textContent = formatTime(0);

        controls.style.display = 'block';
        stopPlayback();
    } catch (error) {
        console.error('Error loading default audio:', error);
        alert('Failed to load default audio file. Make sure "around-the-world-in-80-days-chapter-10.mp3" is in the same folder as your HTML file.');
    }
});

speedBar.addEventListener('input', (e) => {
    let newSpeed = clamp(parseFloat(e.target.value), params.navigation.minSpeed, params.navigation.maxSpeed);

    navigationSpeed = newSpeed;
    speedValue.textContent = newSpeed.toFixed(2);

    gestureTarget = newSpeed;

    // Clear manual pause when user manually adjusts speed
    manuallyPaused = false;

    if (!filterAnimationFrame) {
        updateFilteredSpeed();
    }
});

alphaFingerInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
        params.filtering.alphaFinger = clamp(value, 0.001, 1);
        alphaFingerValue.textContent = params.filtering.alphaFinger.toFixed(3);
        updateAlphaDisplay();
    }
});

alphaNoFingerInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
        params.filtering.alphaNoFinger = clamp(value, 0.0001, 1);
        alphaNoFingerValue.textContent = params.filtering.alphaNoFinger.toFixed(4);
        updateAlphaDisplay();
    }
});

driftTargetInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    // Only update if value is valid (not NaN)
    if (!isNaN(value)) {
        params.filtering.driftTarget = clamp(value, 0.1, 4);
        driftTargetValue.textContent = params.filtering.driftTarget.toFixed(2);
    }
    // If NaN (empty field), keep the previous valid value
});

function updateAlphaDisplay() {
    const currentAlpha = isFingerDetected ? params.filtering.alphaFinger : params.filtering.alphaNoFinger;
    // Show 4 decimal places for very small values, 3 for larger ones
    const decimals = currentAlpha < 0.001 ? 4 : 3;
    activeAlphaDisplay.textContent = currentAlpha.toFixed(decimals);
    
    if (isFingerDetected) {
        activeAlphaDisplay.style.color = '#4ade80';
        alphaStateText.textContent = 'Hand detected - Responsive mode';
        alphaStateText.style.color = '#4ade80';
    } else {
        activeAlphaDisplay.style.color = '#f87171';
        alphaStateText.textContent = 'Drifting - Slow mode';
        alphaStateText.style.color = '#f87171';
    }
}

function updateEffectiveParams() {
    const speed = Math.abs(filteredSpeed);
    const effectiveStep = params.navigation.segmentStep * speed;
    const effectiveInterval = (params.navigation.segmentIntervalMs / 1000) / speed;

    effectiveStepDisplay.textContent = effectiveStep.toFixed(2);
    effectiveIntervalDisplay.textContent = (effectiveInterval * 1000).toFixed(0);
}

segmentDurationInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
        params.navigation.segmentDuration = value;
        updateEffectiveParams();
    }
});

segmentStepInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
        params.navigation.segmentStep = value;
        updateEffectiveParams();
    }
});

segmentIntervalInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
        params.navigation.segmentIntervalMs = value;
        updateEffectiveParams();
    }
});

fadeDurationInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
        params.navigation.fadeDuration = value;
    }
});

function updateFilteredSpeed() {
    // Don't apply speed changes if manually paused
    if (manuallyPaused) {
        if (filterAnimationFrame) {
            cancelAnimationFrame(filterAnimationFrame);
            filterAnimationFrame = null;
        }
        return;
    }

    const alpha = isFingerDetected ? params.filtering.alphaFinger : params.filtering.alphaNoFinger;

    updateAlphaDisplay();

    const oldFilteredSpeed = filteredSpeed;
    filteredSpeed = filteredSpeed - alpha * (filteredSpeed - gestureTarget);

    filteredSpeedValue.textContent = filteredSpeed.toFixed(2);
    filteredSpeedBar.value = filteredSpeed;

    const oldDirection = Math.sign(oldFilteredSpeed);
    const newDirection = Math.sign(filteredSpeed);

    const targetDirection = Math.sign(gestureTarget);
    const aboutToCrossZero = (oldDirection !== 0 && targetDirection !== 0 &&
                              oldDirection !== targetDirection &&
                              Math.abs(filteredSpeed) < 0.2);

    const crossedZero = (oldDirection !== 0 && newDirection !== 0 && oldDirection !== newDirection);

    if ((aboutToCrossZero || crossedZero) && isPlaying) {
        const currentPos = parseFloat(seekBar.value);
        pauseTime = currentPos;
        
        const shouldBeReverse = targetDirection < 0;
        const currentlyReverse = oldFilteredSpeed < 0;
        
        if (shouldBeReverse !== currentlyReverse) {
            if (currentlyReverse) {
                activeSources.forEach((source) => {
                    try { source.stop(); } catch (e) {}
                });
                activeSources.clear();
                if (scheduleTimeout) {
                    clearTimeout(scheduleTimeout);
                    scheduleTimeout = null;
                }
                filteredSpeed = Math.max(0.15, Math.abs(filteredSpeed));
                prevNavigationSpeed = filteredSpeed;
                playForwardNormal(pauseTime);
            } else {
                htmlAudioElement.pause();
                filteredSpeed = -Math.max(0.15, Math.abs(filteredSpeed));
                prevNavigationSpeed = filteredSpeed;
                playReverseChunk(pauseTime);
            }
        }
    } else if (isPlaying) {
        applyFilteredSpeed();
    }

    const diff = Math.abs(gestureTarget - filteredSpeed);
    if (diff > 0.001) {
        filterAnimationFrame = requestAnimationFrame(updateFilteredSpeed);
    } else {
        filteredSpeed = gestureTarget;
        filteredSpeedValue.textContent = filteredSpeed.toFixed(2);
        filteredSpeedBar.value = filteredSpeed;
        if (isPlaying) {
            applyFilteredSpeed();
        }
        filterAnimationFrame = null;
    }
}

function applyFilteredSpeed() {
    if (!isPlaying) return;

    if (filteredSpeed > 0 && htmlAudioElement && !htmlAudioElement.paused) {
        const targetPlaybackRate = Math.abs(filteredSpeed);
        const safePlaybackRate = clamp(targetPlaybackRate, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE);
        htmlAudioElement.playbackRate = safePlaybackRate;
    }

    updateEffectiveParams();
}

seekBar.addEventListener('input', (e) => {
    const newTime = parseFloat(e.target.value);
    pauseTime = newTime;
    currentTimeDisplay.textContent = formatTime(newTime);
    
    if (isPlaying) {
        stopPlayback();
        setTimeout(() => startPlayback(), 100);
    }
});

playBtn.addEventListener('click', startPlayback);
pauseBtn.addEventListener('click', pausePlayback);

resetBtn.addEventListener('click', () => {
    stopPlayback();
    // Clear manual pause on reset
    manuallyPaused = false;

    if (navigationSpeed < 0) {
        pauseTime = audioBuffer.duration;
        seekBar.value = audioBuffer.duration;
        currentTimeDisplay.textContent = formatTime(audioBuffer.duration);
    } else {
        pauseTime = 0;
        seekBar.value = 0;
        currentTimeDisplay.textContent = formatTime(0);
    }
});

function playForwardNormal(startPosition) {
    if (!audioBuffer || !isPlaying) return;

    htmlAudioElement.currentTime = startPosition;
    htmlAudioElement.playbackRate = Math.abs(filteredSpeed);
    htmlAudioElement.play();

    htmlAudioElement.onended = () => {
        if (isPlaying) {
            stopPlayback();
            pauseTime = audioBuffer.duration;
            seekBar.value = audioBuffer.duration;
            currentTimeDisplay.textContent = formatTime(audioBuffer.duration);
            playBtn.style.display = 'inline-block';
            pauseBtn.style.display = 'none';
        }
    };

    updateForwardTimeDisplay();
}

function updateForwardTimeDisplay() {
    if (animationFrame) {
        clearTimeout(animationFrame);
        animationFrame = null;
    }

    const updateInterval = 50;
    const update = () => {
        if (!isPlaying || navigationSpeed < 0) return;

        const currentPos = htmlAudioElement.currentTime;
        seekBar.value = currentPos;
        currentTimeDisplay.textContent = formatTime(currentPos);

        if (currentPos < audioBuffer.duration) {
            animationFrame = setTimeout(update, updateInterval);
        }
    };

    update();
}

function playReverseChunk(chunkEnd) {
    if (!audioBuffer || !isPlaying) return;

    const { segmentDuration, segmentStep, segmentIntervalMs, maxActiveSources, fadeDuration } = params.navigation;
    const chunkStart = Math.max(0, chunkEnd - segmentDuration);
    const chunkDuration = chunkEnd - chunkStart;
    const overlapSeconds = Math.max(segmentDuration - segmentStep, 0);
    const effectiveFade = Math.min(fadeDuration, overlapSeconds / 2, chunkDuration / 2);

    if (chunkDuration <= 0 || chunkEnd <= 0) {
        stopPlayback();
        pauseTime = 0;
        playBtn.style.display = 'inline-block';
        pauseBtn.style.display = 'none';
        return;
    }

    const startSample = Math.floor(chunkStart * audioBuffer.sampleRate);
    const endSample = Math.floor(chunkEnd * audioBuffer.sampleRate);
    const lengthSamples = Math.max(1, endSample - startSample);

    const chunkBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        lengthSamples,
        audioBuffer.sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const originalData = audioBuffer.getChannelData(channel);
        const chunkData = chunkBuffer.getChannelData(channel);

        const copyLength = Math.min(lengthSamples, originalData.length - startSample);
        for (let i = 0; i < copyLength; i++) {
            chunkData[i] = originalData[startSample + i];
        }

        const fadeSamples = Math.min(Math.floor(effectiveFade * audioBuffer.sampleRate), copyLength);
        if (fadeSamples > 1) {
            for (let i = 0; i < fadeSamples; i++) {
                const fadeProgress = (i + 1) / fadeSamples;
                const fadeInGain = Math.sin(fadeProgress * (Math.PI / 2));
                chunkData[i] *= fadeInGain;
                const fadeOutIndex = copyLength - 1 - i;
                if (fadeOutIndex >= 0 && fadeOutIndex < copyLength) {
                    const fadeOutProgress = (i + 1) / fadeSamples;
                    const fadeOutGain = Math.sin((1 - fadeOutProgress) * (Math.PI / 2));
                    chunkData[fadeOutIndex] *= Math.max(fadeOutGain, 0);
                }
            }
        }
    }

    const source = audioContext.createBufferSource();
    source.buffer = chunkBuffer;
    source.playbackRate.value = params.playback.speed;
    source.connect(audioContext.destination);

    currentSource = source;
    startTime = audioContext.currentTime;
    pauseTime = chunkStart;

    source.onended = () => {
        activeSources.delete(source);
    };
    activeSources.add(source);
    enforceMaxActiveSources(maxActiveSources);

    source.start(0);

    updateChunkTimeDisplay(chunkStart, chunkEnd);

    const effectiveStep = segmentStep * Math.abs(filteredSpeed);
    const effectiveInterval = (segmentIntervalMs / 1000) / Math.abs(filteredSpeed);
    scheduleTimeout = setTimeout(() => {
        const nextPosition = Math.max(0, chunkEnd - effectiveStep);
        if (nextPosition <= 0) {
            stopPlayback();
            pauseTime = 0;
            seekBar.value = 0;
            currentTimeDisplay.textContent = formatTime(0);
            playBtn.style.display = 'inline-block';
            pauseBtn.style.display = 'none';
            return;
        }
        playReverseChunk(nextPosition);
    }, effectiveInterval * 1000);
}

function updateChunkTimeDisplay(chunkStart, chunkEnd) {
    if (animationFrame) {
        clearTimeout(animationFrame);
        animationFrame = null;
    }
    const updateInterval = 50;
    const update = () => {
        if (!isPlaying) return;

        const elapsed = (audioContext.currentTime - startTime) * params.playback.speed;
        const currentPos = clamp(chunkStart + elapsed, 0, chunkEnd);

        seekBar.value = currentPos;
        currentTimeDisplay.textContent = formatTime(currentPos);

        if (currentPos > chunkStart && currentPos < chunkEnd) {
            animationFrame = setTimeout(update, updateInterval);
        }
    };

    update();
}

function startPlayback() {
    if (!audioBuffer) return;

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    // Clear manual pause flag when user explicitly starts playback
    manuallyPaused = false;

    if (Math.abs(filteredSpeed) < 0.1) {
        const direction = Math.sign(navigationSpeed) || 1;
        filteredSpeed = direction * 0.5;
        navigationSpeed = filteredSpeed;
        gestureTarget = filteredSpeed;
        speedValue.textContent = navigationSpeed.toFixed(2);
        filteredSpeedValue.textContent = filteredSpeed.toFixed(2);
        speedBar.value = navigationSpeed;
        filteredSpeedBar.value = filteredSpeed;
    }

    if (pauseTime <= 0 && filteredSpeed < 0) {
        filteredSpeed = Math.abs(filteredSpeed);
        navigationSpeed = filteredSpeed;
        gestureTarget = filteredSpeed;
        speedValue.textContent = navigationSpeed.toFixed(2);
        filteredSpeedValue.textContent = filteredSpeed.toFixed(2);
        speedBar.value = navigationSpeed;
        filteredSpeedBar.value = filteredSpeed;
    }

    if (pauseTime >= audioBuffer.duration && filteredSpeed > 0) {
        pauseTime = 0;
        seekBar.value = 0;
        currentTimeDisplay.textContent = formatTime(0);
    }

    if (pauseTime <= 0 && filteredSpeed < 0) {
        pauseTime = audioBuffer.duration;
        seekBar.value = audioBuffer.duration;
        currentTimeDisplay.textContent = formatTime(audioBuffer.duration);
    }

    isPlaying = true;
    playBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-block';

    prevNavigationSpeed = filteredSpeed;

    if (filteredSpeed < 0) {
        playReverseChunk(pauseTime);
    } else {
        playForwardNormal(pauseTime);
    }
}

function pausePlayback() {
    // Set manual pause flag to prevent hand tracking from overriding pause
    manuallyPaused = true;

    if (navigationSpeed > 0 && htmlAudioElement.currentTime > 0) {
        pauseTime = htmlAudioElement.currentTime;
    } else {
        pauseTime = parseFloat(seekBar.value);
    }

    stopPlayback();
    playBtn.style.display = 'inline-block';
    pauseBtn.style.display = 'none';
}

function stopPlayback() {
    isPlaying = false;

    htmlAudioElement.pause();

    activeSources.forEach((source) => {
        try {
            source.stop();
        } catch (e) {}
    });
    activeSources.clear();
    currentSource = null;

    if (animationFrame) {
        clearTimeout(animationFrame);
        animationFrame = null;
    }

    if (scheduleTimeout) {
        clearTimeout(scheduleTimeout);
        scheduleTimeout = null;
    }

    if (speedSmoothingHandle) {
        cancelAnimationFrame(speedSmoothingHandle);
        speedSmoothingHandle = null;
    }

    if (filterAnimationFrame) {
        cancelAnimationFrame(filterAnimationFrame);
        filterAnimationFrame = null;
    }
}

function formatTime(time) {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function updateTargetNavigationSpeed(target) {
    target = clamp(target, params.navigation.minSpeed, params.navigation.maxSpeed);
    
    speedBar.value = target;
    navigationSpeed = target;
    speedValue.textContent = navigationSpeed.toFixed(2);
    speedState.target = target;
    
    gestureTarget = target;

    if (!filterAnimationFrame) {
        updateFilteredSpeed();
    }

    if (!isPlaying) {
        filteredSpeed = target;
        filteredSpeedValue.textContent = filteredSpeed.toFixed(2);
        filteredSpeedBar.value = filteredSpeed;
        speedState.current = target;
        speedState.velocity = 0;
        speedState.boost = 0;
        
        if (filterAnimationFrame) {
            cancelAnimationFrame(filterAnimationFrame);
            filterAnimationFrame = null;
        }
    }
}

function enforceMaxActiveSources(limit) {
    while (activeSources.size > limit) {
        const oldest = activeSources.values().next().value;
        if (!oldest) break;
        activeSources.delete(oldest);
        try {
            oldest.stop();
        } catch (e) {}
    }
}

// Control mode toggle event listeners
distanceModeRadio.addEventListener('change', () => {
    if (distanceModeRadio.checked) {
        controlMode = 'distance';
        distanceModeInstructions.style.display = 'block';
        speedModeInstructions.style.display = 'none';
        resetRotationState();
        velocityHistory = [];
        fingerVelocity = 0;
    }
});

speedModeRadio.addEventListener('change', () => {
    if (speedModeRadio.checked) {
        controlMode = 'speed';
        distanceModeInstructions.style.display = 'none';
        speedModeInstructions.style.display = 'block';
        resetRotationState();
        velocityHistory = [];
        fingerVelocity = 0;
    }
});

window.addEventListener('load', () => {
    setTimeout(() => {
        initializeHands();
    }, 1000);
});