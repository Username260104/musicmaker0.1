let handPose;
let video;
let rawHands = [];
let smoothHands = [];
let isAudioStarted = false;

// --- CONFIGURATION ---
const CONFIG = {
    VIDEO: { width: 640, height: 480 },
    LERP_FACTOR: 0.2, // Smoothing factor (Lower = Smoother but slower)
    PINCH: {
        ON: 30,  // Distance to trigger pinch
        OFF: 40  // Distance to release pinch (Hysteresis)
    },
    FREQ: { min: 523.25, max: 2093.0 }, // Pitch Range: C5 to C7 (High-pitched)
    FILTER: { min: 100, max: 5000 }, // Filter Range
    COLORS: {
        HAND: [255, 0, 85],
        TEXT: 255,
        ACTIVE: [0, 255, 0],
        INACTIVE: 100,
        BG_RECT: [0, 150]
    }
};

const FINGER_CONNECTIONS = [
    [0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]
];

// --- APP STATE ---
let state = {
    activeNote: "-",
    activeSynthName: "None",

    // Pinch States (for Hysteresis)
    pinches: {
        lead: false, chip: false, bell: false, // Left
        kick: false, snare: false, bass: false // Right
    },

    // Rhythm Visual Status
    rhythm: {
        kick: false, snare: false, bass: false
    }
};

// --- AUDIO OBJECTS ---
const audio = {
    synths: { lead: null, chip: null, bell: null },
    drums: { kick: null, snare: null, bass: null },
    parts: { kick: null, snare: null, bass: null }
};


function preload() {
    handPose = ml5.handPose();
}

function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');

    video = createCapture(VIDEO);
    video.size(CONFIG.VIDEO.width, CONFIG.VIDEO.height);
    video.hide();

    handPose.detectStart(video, gotHands);

    setupAudio();
    isAudioStarted = true;
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

function mousePressed() {
    if (Tone.context.state !== 'running') {
        Tone.start();
    }
}

function gotHands(results) {
    rawHands = results;
}

function draw() {
    background(0);

    // 1. Hand Smoothing Logic
    updateSmoothHands();

    // 2. Video Mirror & Scale
    push();
    translate(width, 0);
    scale(-1, 1);

    let scaleF = max(width / video.width, height / video.height);
    let newW = video.width * scaleF;
    let newH = video.height * scaleF;
    let offX = (width - newW) / 2;
    let offY = (height - newH) / 2;

    image(video, offX, offY, newW, newH);

    // 3. Draw Hands & Interactions
    translate(offX, offY);
    scale(scaleF);

    // Use smoothHands for drawing and interaction
    for (let hand of smoothHands) {
        drawHandSkeleton(hand);
        drawHandLabel(hand);

        if (isAudioStarted) {
            handleHandInteraction(hand);
        }
    }

    pop();

    drawDashboard();
}

// --- SMOOTHING LOGIC ---
function updateSmoothHands() {
    // If number of hands changes, reset or adapt immediately to avoid glitches
    if (rawHands.length !== smoothHands.length) {
        smoothHands = JSON.parse(JSON.stringify(rawHands)); // Deep copy init
        return;
    }

    for (let i = 0; i < rawHands.length; i++) {
        let raw = rawHands[i];
        let smooth = smoothHands[i];

        // Handedness usually doesn't flicker, but copy it to be safe
        smooth.handedness = raw.handedness;

        // Lerp Keypoints
        for (let j = 0; j < raw.keypoints.length; j++) {
            let rk = raw.keypoints[j];
            let sk = smooth.keypoints[j];

            sk.x = lerp(sk.x, rk.x, CONFIG.LERP_FACTOR);
            sk.y = lerp(sk.y, rk.y, CONFIG.LERP_FACTOR);
        }
    }
}

// --- VISUAL HELPERS ---

function drawHandSkeleton(hand) {
    stroke(CONFIG.COLORS.HAND);
    strokeWeight(4); // Thicker lines
    noFill();

    let k = hand.keypoints;
    for (let connection of FINGER_CONNECTIONS) {
        for (let j = 0; j < connection.length - 1; j++) {
            let p1 = k[connection[j]];
            let p2 = k[connection[j + 1]];

            // Jitter effect for Glitch vibe
            let jitterX = random(-2, 2);
            let jitterY = random(-2, 2);

            line(p1.x + jitterX, p1.y + jitterY, p2.x + jitterX, p2.y + jitterY);
        }
    }

    noStroke();
    fill(CONFIG.COLORS.HAND);
    for (let point of k) {
        let jitterX = random(-1, 1);
        let jitterY = random(-1, 1);
        circle(point.x + jitterX, point.y + jitterY, 8); // Slightly larger joints
    }
}

function drawHandLabel(hand) {
    let isRightHand = hand.handedness === "Left";
    let label = isRightHand ? "R" : "L";

    let highestY = Infinity;
    let sumX = 0;
    for (let kp of hand.keypoints) {
        if (kp.y < highestY) highestY = kp.y;
        sumX += kp.x;
    }
    let centerX = sumX / hand.keypoints.length;

    push();
    translate(centerX, highestY - 10);
    scale(-1, 1);
    fill(CONFIG.COLORS.TEXT);
    noStroke();
    textSize(24);
    textAlign(CENTER, BOTTOM);
    text(label, 0, 0);
    pop();
}

function drawDashboard() {
    push();
    textAlign(LEFT, TOP);
    textSize(20);
    noStroke();

    // Melody Status
    fill(CONFIG.COLORS.BG_RECT);
    rect(10, 10, 200, 80, 10);
    fill(CONFIG.COLORS.TEXT); // Cyan
    text("MELODY (Left)", 20, 20);
    text(`Note: ${state.activeNote}`, 20, 50);
    text(`Synth: ${state.activeSynthName}`, 20, 75);

    // Rhythm Status
    textAlign(RIGHT, TOP);
    fill(CONFIG.COLORS.BG_RECT);
    rect(width - 210, 10, 200, 110, 10);
    fill(CONFIG.COLORS.TEXT); // Cyan
    text("RHYTHM (Right)", width - 20, 20);

    drawStatusLine("GABBER KICK", state.rhythm.kick, 50);
    drawStatusLine("METALLIC SNARE", state.rhythm.snare, 75);
    drawStatusLine("TRAP HATS", state.rhythm.bass, 100);

    pop();
}

function drawStatusLine(label, isActive, y) {
    if (isActive) fill(CONFIG.COLORS.ACTIVE); else fill(CONFIG.COLORS.INACTIVE);
    text(`[ ${isActive ? "ON" : "OFF"} ]  ${label}`, width - 20, y);
}

// --- INTERACTION LOGIC ---

function handleHandInteraction(hand) {
    let isRightHand = hand.handedness === "Left";
    if (isRightHand) {
        handleRightHand(hand);
    } else {
        handleLeftHand(hand);
    }
}

function handleLeftHand(hand) {
    let thumb = hand.keypoints[4];

    // Pitch (Y-axis)
    // Pitch (Y-axis) - Map to Scale
    // Y축을 기준으로 주파수를 매핑 (Map Y-axis to frequency)
    let rawFreq = map(thumb.y, height, 0, CONFIG.FREQ.min, CONFIG.FREQ.max);

    // Scale Mapping: Major Pentatonic (C5 - C7)
    // 장조 5음계 매핑 (Major Pentatonic)
    let note = getHyperpopNote(rawFreq);
    let freq = Tone.Frequency(note).toFrequency();

    state.activeNote = note;

    // Filter (X-axis)
    let filterFreq = map(thumb.x, 0, width, CONFIG.FILTER.min, CONFIG.FILTER.max);
    filterFreq = constrain(filterFreq, CONFIG.FILTER.min, CONFIG.FILTER.max);

    if (audio.synths.lead) audio.synths.lead.filterEnvelope.baseFrequency = filterFreq;

    let k = hand.keypoints;
    let anyActive = false;

    // Index -> Lead
    if (checkPinch(thumb, k[8], 'lead')) {
        updateSynth(audio.synths.lead, 'lead', freq, "Hyperpop Lead");
        anyActive = true;
    } else {
        releaseSynth(audio.synths.lead, 'lead');
    }

    // Middle -> Chip
    if (checkPinch(thumb, k[12], 'chip')) {
        updateSynth(audio.synths.chip, 'chip', freq, "8-bit Chip");
        anyActive = true;
    } else {
        releaseSynth(audio.synths.chip, 'chip');
    }

    // Ring -> Bell
    if (checkPinch(thumb, k[16], 'bell')) {
        updateSynth(audio.synths.bell, 'bell', freq, "FM Bell");
        anyActive = true;
    } else {
        releaseSynth(audio.synths.bell, 'bell');
    }

    if (!anyActive) state.activeSynthName = "None";
}

function handleRightHand(hand) {
    let thumb = hand.keypoints[4];
    let k = hand.keypoints;

    // Index -> Kick
    if (checkPinch(thumb, k[8], 'kick')) {
        toggleRhythm('kick');
    } else {
        resetPinchTrigger('kick'); // Only reset trigger lock, not the toggle state
    }

    // Middle -> Snare
    if (checkPinch(thumb, k[12], 'snare')) {
        toggleRhythm('snare');
    } else {
        resetPinchTrigger('snare');
    }

    // Ring -> Hi-hats
    if (checkPinch(thumb, k[16], 'bass')) {
        toggleRhythm('bass');
    } else {
        resetPinchTrigger('bass');
    }
}

// --- LOGIC HELPERS ---

// Robust Pinch Detection with Hysteresis
function checkPinch(p1, p2, stateKey) {
    let d = dist(p1.x, p1.y, p2.x, p2.y);
    let wasPinched = state.pinches[stateKey]; // Check *previous* frame state (or toggle lock state)

    // BUT: pinchStates structure is mixed.
    // For Melody (Left): state.pinches[key] tracks if the NOTE IS ON.
    // For Rhythm (Right): state.pinches[key] tracks if the TRIGGER IS LOCKED (to avoid rapid toggling).

    // Hysteresis Logic:
    // If currently pinched, release only if distance > OFF
    // If currently NOT pinched, trigger only if distance < ON
    if (wasPinched) {
        return d < CONFIG.PINCH.OFF;
    } else {
        return d < CONFIG.PINCH.ON;
    }
}

function updateSynth(synth, pinchKey, freq, name) {
    // pinchKey state is handled by checkPinch return value mostly, 
    // but we need to track it in state to support Hysteresis in next frame.
    // Actually, checkPinch reads state, but here we WRITE state.

    if (!state.pinches[pinchKey]) {
        // Just started pinching
        synth.triggerAttack(freq);
        state.pinches[pinchKey] = true;
        state.activeSynthName = name;
    } else {
        // Sustaining pinch
        // Portamento sets the ramp time to the new frequency
        // 포르타멘토 효과 적용 (Portamento effect) - 0.1s
        synth.setNote(freq, 0.1);
    }
}

function releaseSynth(synth, pinchKey) {
    if (state.pinches[pinchKey]) {
        synth.triggerRelease();
        state.pinches[pinchKey] = false;
    }
}

function toggleRhythm(partKey) {
    // For rhythm, 'state.pinches[partKey]' acts as a LOCK.
    // It is TRUE if the fingers are close (pinched).
    // It becomes FALSE only when fingers move far apart.
    // The TOGGLE happens EXACTLY when it transitions from FALSE to TRUE.

    // However, checkPinch already returned TRUE.
    // So we need to know if it WAS false before.
    // Wait, updateSynth/toggleRhythm are only called IF checkPinch is true.

    if (!state.pinches[partKey]) {
        // This is the MOMENT of pinch (Rising Edge)
        let part = audio.parts[partKey];
        part.mute = !part.mute;
        state.rhythm[partKey] = !part.mute;
        state.pinches[partKey] = true; // Lock it
    }

    // If it was already true, we do nothing (wait for release)
}

function resetPinchTrigger(partKey) {
    // Called when checkPinch returns false
    state.pinches[partKey] = false;
}


// --- AUDIO SETUP ---
function setupAudio() {
    Tone.Transport.bpm.value = 160; // Hyperpop Speed

    // 1. Hyperpop Lead (Left Hand)
    // "Digital," "Fried," "Glitchy" Sound
    // 디지털하고 깨지는 듯한 글리치 사운드
    const bitCrusher = new Tone.BitCrusher(4).toDestination();
    const distortion = new Tone.Distortion(0.8).connect(bitCrusher);
    const chebyshev = new Tone.Chebyshev(50).connect(distortion);

    audio.synths.lead = new Tone.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 },
        filterEnvelope: { baseFrequency: 200, octaves: 4, exponent: 2 },
        portamento: 0.1 // Sliding effect
    }).connect(chebyshev);

    // Backup synths (can be used for other fingers if desired, keeping simple for now)
    audio.synths.chip = new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.1 }
    }).toDestination(); // Simple chip sound

    audio.synths.bell = new Tone.FMSynth().toDestination();


    // 2. Glitchcore Rhythm (Right Hand)

    // Kick: Distorted Gabber Style
    // 왜곡된 개버 스타일 킥 (Distorted Gabber Kick)
    const kickDist = new Tone.Distortion(0.8).toDestination();
    audio.drums.kick = new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 10,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
        volume: -5
    }).connect(kickDist);


    // Snare: Sharp, Metallic
    // 날카롭고 금속성 스네어 (Sharp, Metallic Snare)
    audio.drums.snare = new Tone.MetalSynth({
        frequency: 200,
        envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5,
        volume: -10
    }).toDestination();

    // Hi-hat: Fast Rolls
    // 빠른 하이햇 롤 (Fast Hi-hat Rolls)
    audio.drums.bass = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0 }
    }).toDestination(); // Re-purposing 'bass' slot for Hi-hats as requested "Hi-hat/Bass Loop"


    // -- LOOPS --

    // Kick: Driven 4/4 with some skips
    audio.parts.kick = createLoop(audio.drums.kick, "C1", ["0:0", "0:0.75", "0:1", "0:2", "0:2.75", "0:3"]);

    // Snare: Syncopated
    audio.parts.snare = createLoop(audio.drums.snare, null, ["0:1.25", "0:3"]);

    // Hi-hats: Fast 16th/32nd rolls (Trap Style)
    // 트랩 스타일의 빠른 하이햇 (Fast Trap-style Hi-hats)
    let hatPattern = [];
    for (let i = 0; i < 16; i++) {
        hatPattern.push(`0:0:${i}`); // 16th notes
    }
    // Add some rapid fire triplet rolls
    hatPattern.push("0:1:0.33", "0:1:0.66");

    audio.parts.bass = createLoop(audio.drums.bass, null, hatPattern);

    Tone.Transport.start();
}

function createLoop(inst, note, times) {
    let part = new Tone.Part((time) => {
        if (note) inst.triggerAttackRelease(note, "8n", time);
        else inst.triggerAttackRelease("8n", time);
    }, times.map(t => ({ time: t })));
    configureLoop(part);
    return part;
}

function configureLoop(part) {
    part.loop = true;
    part.loopEnd = "1m";
    part.start(0);
    part.mute = true;
}

// Major Pentatonic Scale: C, D, E, G, A
const PENTATONIC_SCALE = [
    "C5", "D5", "E5", "G5", "A5",
    "C6", "D6", "E6", "G6", "A6",
    "C7"
];

function getHyperpopNote(freq) {
    // Map frequency roughly to the closest note in our scale
    // Simple approach: map input frequency range linearly to the array index

    // Normalizing freq to 0-1 range based on min/max
    let t = map(freq, CONFIG.FREQ.min, CONFIG.FREQ.max, 0, 1);
    t = constrain(t, 0, 1);

    let index = Math.floor(t * (PENTATONIC_SCALE.length - 1));
    return PENTATONIC_SCALE[index];
}
