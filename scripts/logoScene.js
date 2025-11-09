// Three.js scene loader for Noir Hound Digital logo area
// Loads GLB from assets/NoirHoundLogoScene.glb
// Camera copies pose from 'camerareference1' and always looks at 'positionTarget'
// Lights: toggle visibility via buttons, and move 'LightMoving' between 'lightreference1' and 'lightreference2' based on pointer X

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, GlitchEffect, HueSaturationEffect } from 'postprocessing';

// ===================== Mobile Detection =====================
function isMobileDevice() {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768
  );
}

console.info('[logoScene] module evaluating');
let stage = null;
let mount = null;
let initialized = false;

// ===================== Inversion debug & self-heal (early) =====================
const INVERT_DEBUG = true; // set true to log inversion lifecycle
let invertDebugCount = 0;
function debugInvert(label){
  if (!INVERT_DEBUG) return;
  if (!renderer?.domElement) return;
  if (invertDebugCount > 40) return; // cap logs
  invertDebugCount++;
  const themeAttr = document.documentElement.getAttribute('data-theme');
  const canvasFilter = renderer.domElement.style.filter || '(none)';
  console.info('[invertDebug]', {label, themeAttr, invertEnabled, monoEnabled, canvasFilter});
}

// Reassert inversion if it "drops" (e.g., filter cleared by another write) during first few seconds
function scheduleInvertSelfHeal(){
  const start = performance.now();
  function tick(){
    if (!renderer?.domElement) return;
    const elapsed = performance.now() - start;
    const needs = invertEnabled && !renderer.domElement.style.filter.includes('invert');
    if (needs){
      setInvertEnabled(true); // will log via debugInvert
    } else {
      debugInvert('selfHealTick');
    }
    if (elapsed < 6000) { // monitor for first 6s
      setTimeout(tick, 500);
    }
  }
  setTimeout(tick, 500);
}

// Hard-coded reference positions (world space) for camera and moving light
const REF = {
  // Updated per user: y=-26.62, z=3.05, x varies
  cam1: new THREE.Vector3(-5.729, 3.05, 26.62),
  cam2: new THREE.Vector3( 6.489, 3.05, 26.62),
  camHome: new THREE.Vector3(0.38, 3.05, 26.62),
  light1: new THREE.Vector3(-0.2658, 0.4717, -0.5677),
  light2: new THREE.Vector3( 0.4972, 0.4717, -0.5677)
};

let renderer, scene, camera, controls;
let composer = null; // postprocessing composer
let glitchEffect = null; // glitch effect (enabled during burst only)
let hueSatEffect = null; // saturation=-1 to force grayscale
let glitchPass = null; // glitch-only effect pass
let hueSatPass = null; // grayscale-only pass (always on)
let manualGlitchActive = false; // user toggled continuous glitch
let burstGlitchActive = false; // theme toggle burst in progress

function updateGlitchPassEnabled(){
  if (!glitchPass || !hueSatPass) return;
  // Determine active state
  const active = manualGlitchActive || burstGlitchActive;
  // Enable/disable glitch pass
  glitchPass.enabled = active;
  // Ensure something renders to screen: if glitch disabled, hueSatPass becomes terminal pass.
  if (active) {
    // Glitch is final output
    glitchPass.renderToScreen = true;
    hueSatPass.renderToScreen = false;
  } else {
    // Grayscale pass outputs directly
    hueSatPass.renderToScreen = true;
    glitchPass.renderToScreen = false;
  }
}
let ambientLight = null;
let boosted = false;
const lightOriginalIntensity = new Map();
let cameraOriginalPos = null, cameraOriginalQuat = null;
let camRef2 = null;
let shadowUI = {
  biasInput: null,
  biasValue: null,
  normalBiasInput: null,
  normalBiasValue: null
};
let glbRoot;
let clock = new THREE.Clock();
let pointerX = 0.5; // normalized 0..1
let movingLight, lightFront, lightBack;
let lightRef1, lightRef2, positionTarget, camRef1;
let dogOriginalMaterials = new Map(); // cache original Dog materials for toggling
let dogUsingOriginal = false;
let tmpV = new THREE.Vector3();
let targetWorld = new THREE.Vector3();
let movingTargetLocal = new THREE.Vector3();
let axesHelper, boundsHelpers = [];
let shadowShape = null; // optional overlay shadow object
let dogObj = null; // cache Dog mesh/group for shadow toggling
let movingLightHelper = null; // SpotLightHelper for moving light
// Scene bounding box (computed after GLB load) for camera fitting
let sceneBoundingBox = null; // for fit-to-view calculations
// Camera tween state
let camTween = null;
// ShadowShape fade state
let shadowFade = null; // { start, end, t0, dur }
let currentShadowOpacity = 0.0; // start invisible immediately on first load
let didInitialShadowFade = false;
let shadowArrivalSession = 0; // invalidation token for scheduled arrival effects
let shadowFadeStartTimerId = null;
let shadowDisableTimerId = null;

function tryInit(){
  if (initialized) return;
  stage = document.getElementById('logoStage');
  mount = document.getElementById('threeContainer');
  if (stage && mount) {
    initialized = true;
    console.info('[logoScene] init start');
    init();
  }
}

// Attempt immediately, then on DOMContentLoaded, then on window load as a fallback
tryInit();
document.addEventListener('DOMContentLoaded', tryInit, { once: true });
window.addEventListener('load', tryInit, { once: true });

function init(){
  debugInvert('init() begin');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  mount.appendChild(renderer.domElement);

  // Ensure initial invert state matches current theme on first load
  // Defer inversion until after the theme initialization script and main.js have both run.
  // We use DOMContentLoaded + a short timeout chain for reliability across browsers.
  const applyInitialInvert = () => {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    debugInvert('applyInitialInvert themeAttr:' + theme);
    setInvertEnabled(theme === 'dark');
    requestAnimationFrame(() => {
      const theme2 = document.documentElement.getAttribute('data-theme') || 'light';
      debugInvert('postFrameInvertCheck themeAttr:' + theme2);
      setInvertEnabled(theme2 === 'dark');
      scheduleInvertSelfHeal();
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(applyInitialInvert, 0), { once: true });
  } else {
    // DOM already ready; still delay to allow inline theme script + main.js setTheme
    setTimeout(applyInitialInvert, 0);
  }

  scene = new THREE.Scene();

  // Camera: create a default, will copy transform later
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000); // temp FOV; will be overwritten by lens/sensor defaults

  // Resize now
  onResize();
  window.addEventListener('resize', onResize);

  // Pointer to drive moving light (use full window width)
  // On mobile: disable camera controls and use touch to move shadow horizontally
  const isMobile = isMobileDevice();
  
  window.addEventListener('pointermove', (e) => {
    const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || stage.clientWidth);
    pointerX = THREE.MathUtils.clamp(e.clientX / w, 0, 1);
    if (!inMenuRegion && !didInitialShadowFade) { fadeShadowShapeTo(0, 150); didInitialShadowFade = true; }
    if (!inMenuRegion) { fadeShadowShapeTo(0, 120); cancelShadowShapeArrivalEffects(); }
  }, { passive: true });

  // Load GLB
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);

  loader.load('./assets/NoirHoundLogoScene.glb', (gltf) => {
    glbRoot = gltf.scene || gltf.scenes[0];
    scene.add(glbRoot);

    // Find references by name
  camRef1 = scene.getObjectByName('camerareference1');
  camRef2 = scene.getObjectByName('camerareference2');
      let camRef1Pose = null, camRef2Pose = null; // cached camera reference poses (world space)
    positionTarget = scene.getObjectByName('positionTarget');

      // Cache camera reference world poses so refs can be removed from GLB later
      if (camRef1) {
        camRef1.updateMatrixWorld();
        camRef1Pose = {
          pos: camRef1.getWorldPosition(new THREE.Vector3()),
          quat: camRef1.getWorldQuaternion(new THREE.Quaternion())
        };
      }
      if (camRef2) {
        camRef2.updateMatrixWorld();
        camRef2Pose = {
          pos: camRef2.getWorldPosition(new THREE.Vector3()),
          quat: camRef2.getWorldQuaternion(new THREE.Quaternion())
        };
      }
  // Lights
  // Robust name lookups (handle space/no-space variations)
  lightBack = scene.getObjectByName('light backward') || scene.getObjectByName('lightbackward');
    lightFront = scene.getObjectByName('lightfront');
    movingLight = scene.getObjectByName('LightMoving');
    lightRef1 = scene.getObjectByName('lightreference1');
    lightRef2 = scene.getObjectByName('lightreference2');
  // Record original intensities for boost toggle
  [lightBack, lightFront, movingLight].forEach((l) => { if (l && l.isLight) lightOriginalIntensity.set(l, l.intensity); });

    // If the GLB contains a camera node called 'Camera', prefer its params
    const glbCam = scene.getObjectByName('Camera');
    if (glbCam && glbCam.isCamera) {
      camera = glbCam;
    }

    // Record original camera transform from GLB so we can restore
    if (camera) {
      camera.updateMatrixWorld();
      cameraOriginalPos = camera.position.clone();
      cameraOriginalQuat = camera.quaternion.clone();
    }

    // OrbitControls for inspection; target will be positionTarget if available
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 0.2;
    controls.maxDistance = 10;
    
    // Disable OrbitControls on mobile, but limit rotation on desktop
    if (isMobile) {
      controls.enabled = false;
    } else {
      // PC: enable but limit rotation range to ±5 units from home position
      controls.minPolarAngle = Math.max(0, controls.getPolarAngle() - 0.1); // ~17 degrees down
      controls.maxPolarAngle = Math.min(Math.PI, controls.getPolarAngle() + 0.1); // ~17 degrees up
      controls.minAzimuthAngle = controls.getAzimuthalAngle() - 0.2; // ~17 degrees left
      controls.maxAzimuthAngle = controls.getAzimuthalAngle() + 0.2; // ~17 degrees right
    }

  // Ensure moving light is shadow-capable and configure shadows
  ensureMovingLightShadowCapable();
  setupShadows();
  // Set all light intensities to match slider default (100)
  setAllLightsIntensity(100);
    // Replace problematic/black materials with a visible ground material for debugging/initial pass
    replaceGroundMaterial();
  // Ensure Dog casts shadows and Ground receives them
  setupDogGroundShadows();
  // Cache Dog's original material(s) then apply matte black test material (toggle restores)
    // Cache Dog's original material(s); default to original unless toggled
    cacheDogOriginalMaterials();

  // Grab optional ShadowShape object
  shadowShape = scene.getObjectByName('ShadowShape');
  if (shadowShape) prepareShadowShape(shadowShape);

  // Initialize light toggles UI
    hookupLightToggles();
    hookupDebugControls();
  hookupCameraControls();
  hookupLightScaling();
  hookupShadowControls();
  hookupIntensitySlider();
  hookupDogMaterialToggle();
  hookupCameraSettings();
  hookupBeamAndLogoYOffset();
  hookupTestCollapse();
  // Nudge camera back slightly so the scene fits a bit more
  adjustCameraDistanceMultiplier(1.1);
  // Apply default lens/sensor immediately (1000mm lens, 30mm sensor height => FOV ≈ 1.72°)
  applyCameraLensSensorDefaults(1000, 30);

    // Log diagnostics
    const materials = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        if (Array.isArray(obj.material)) materials.push(...obj.material); else materials.push(obj.material);
      }
    });
    console.info('[logoScene] Loaded GLB', {
      camera: camera?.name,
      hasCamRef1: !!camRef1,
      hasCamRef2: !!camRef2,
      positionTarget: !!positionTarget,
      lightBack: !!lightBack,
      lightFront: !!lightFront,
      movingLight: !!movingLight,
      lightRef1: !!lightRef1,
      lightRef2: !!lightRef2,
      materialCount: materials.length,
    });

  // Precompute bounds for fitting (can press Fit Scene later too)
  computeSceneBounds();
  // Print reference world positions for verification
  logReferencePositions();

    // ================= Postprocessing Setup (separate grayscale + glitch passes) =================
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Grayscale pass always active to enforce B/W styling
    hueSatEffect = new HueSaturationEffect({ hue: 0.0, saturation: -1.0 });
    hueSatPass = new EffectPass(camera, hueSatEffect);
    composer.addPass(hueSatPass);
    // Glitch pass (initially disabled) isolated so start/stop truly toggles effect
    glitchEffect = new GlitchEffect({
      chromaticAberrationOffset: new THREE.Vector2(0.0, 0.0),
      delay: new THREE.Vector2(0.1, 0.3),
      duration: new THREE.Vector2(0.05, 0.18),
      strength: new THREE.Vector2(0.2, 0.5)
    });
    glitchPass = new EffectPass(camera, glitchEffect);
    glitchPass.enabled = false; // start disabled
    composer.addPass(glitchPass);
    // Ensure a pass renders at startup (grayscale) then trigger a one-time burst
    updateGlitchPassEnabled();
    setTimeout(() => { try { triggerGlitchBurst(); } catch(e) { console.warn('[logoScene] startup burst failed', e); } }, 60);

    animate();
  }, undefined, (err) => {
    console.error('Failed to load GLB', err);
  });
}

function onResize(){
  const rect = stage.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  // Set internal buffer size without affecting CSS layout
  renderer.setSize(w, h, false);
  // Ensure CSS size matches container (avoid squish from devicePixelRatio changes)
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  if (camera && camera.isPerspectiveCamera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  if (composer) composer.setSize(w, h);
}

function hookupLightToggles(){
  document.querySelectorAll('[data-light-toggle]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-light-toggle');
      const obj = (key === 'light backward') ? lightBack : (key === 'lightfront') ? lightFront : (key === 'LightMoving') ? movingLight : null;
      if (!obj) return;
      obj.visible = !obj.visible;
      btn.setAttribute('aria-pressed', obj.visible ? 'false' : 'true');
      btn.style.opacity = obj.visible ? '1' : '0.55';
    });
  });
}

function hookupDebugControls(){
  document.querySelectorAll('[data-debug]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-debug');
      if (mode === 'axes') toggleAxes();
      if (mode === 'bounds') toggleBounds();
      if (mode === 'materials') logMaterials();
      if (mode === 'mono') toggleMonochrome(btn);
      if (mode === 'filters-off') disableFilters(btn);
      if (mode === 'test-spot') addTestSpot();
      if (mode === 'spot-helper') toggleMovingLightHelper(btn);
      if (mode === 'wire') toggleWireframe(); // moved to Mat panel
    });
  });

  // Glitch start/stop direct controls (postprocessing continuous enable)
  const startBtn = document.getElementById('glitchStartBtn');
  const stopBtn = document.getElementById('glitchStopBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      manualGlitchActive = true;
      updateGlitchPassEnabled();
      startBtn.style.opacity = '1';
      if (stopBtn) stopBtn.style.opacity = '0.6';
      console.info('[logoScene] Glitch effect manually started');
    });
  }

  // Ambient & Boost now live in Lights panel; re-wire there if present
  const ambientBtn = document.querySelector('[data-debug="ambient"]');
  if (ambientBtn) ambientBtn.addEventListener('click', () => toggleAmbient(ambientBtn));
  const boostBtn = document.querySelector('[data-debug="boost"]');
  if (boostBtn) boostBtn.addEventListener('click', () => toggleBoost(boostBtn));
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      manualGlitchActive = false;
      updateGlitchPassEnabled();
      stopBtn.style.opacity = '1';
      if (startBtn) startBtn.style.opacity = '0.6';
      console.info('[logoScene] Glitch effect manually stopped');
    });
  }

  // Keyboard shortcuts for quick testing
  window.addEventListener('keydown', (e) => {
    if (e.key === 'a' || e.key === 'A') toggleAmbient();
    if (e.key === 'l' || e.key === 'L') toggleBoost();
  });
}

function hookupCameraControls(){
  // Removed Cam Lerp & GLB Cam per user request; keep function for future extensibility.
}

function hookupLightScaling(){
  document.querySelectorAll('[data-light-scale]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-light-scale');
      const lights = [lightBack, lightFront, movingLight].filter(l => l && l.isLight);
      if (!lights.length) return;
      if (mode === 'down') {
        lights.forEach(l => l.intensity = Math.max(0, l.intensity * 0.7));
      } else if (mode === 'up') {
        lights.forEach(l => l.intensity = l.intensity * 1.3);
      } else if (mode === 'reset') {
        lights.forEach(l => {
          const base = lightOriginalIntensity.get(l);
          if (typeof base === 'number') l.intensity = base;
        });
      }
    });
  });
}

// New unified intensity slider (0-2000) default 1000
function hookupIntensitySlider(){
  const slider = document.getElementById('lightsIntensity');
  const readout = document.getElementById('lightsIntensityValue');
  if (!slider || !readout) return;
  // Initialize lights to current slider value
  const init = parseFloat(slider.value);
  const lights = [lightBack, lightFront, movingLight].filter(l => l && l.isLight);
  lights.forEach(l => { l.intensity = init; lightOriginalIntensity.set(l, init); });
  readout.textContent = init.toFixed(0);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    readout.textContent = v.toFixed(0);
    lights.forEach(l => { l.intensity = v; });
  });
}

function hookupShadowControls(){
  shadowUI.biasInput = document.getElementById('shadowBias');
  shadowUI.biasValue = document.getElementById('shadowBiasValue');
  shadowUI.normalBiasInput = document.getElementById('shadowNormalBias');
  shadowUI.normalBiasValue = document.getElementById('shadowNormalBiasValue');
  shadowUI.penumbraInput = document.getElementById('spotPenumbra');
  shadowUI.penumbraValue = document.getElementById('spotPenumbraValue');

  // Map size buttons
  document.querySelectorAll('[data-shadow-size]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const size = parseInt(btn.getAttribute('data-shadow-size'), 10);
      const lights = [movingLight, lightFront, lightBack].filter(l => l && l.isLight && l.castShadow);
      lights.forEach(l => {
        if (l.shadow && l.shadow.mapSize) {
          l.shadow.mapSize.set(size, size);
          // Force recompile by disposing existing shadow map
          if (l.shadow.map) l.shadow.map.dispose();
        }
      });
      console.info('[logoScene] Shadow map size set to', size);
    });
  });

  function updateBiasDisplay(){
    if (shadowUI.biasValue && movingLight?.shadow) shadowUI.biasValue.textContent = movingLight.shadow.bias.toFixed(4);
    if (shadowUI.normalBiasValue && movingLight?.shadow) shadowUI.normalBiasValue.textContent = (movingLight.shadow.normalBias || 0).toFixed(2);
    if (shadowUI.penumbraValue && movingLight?.isSpotLight) shadowUI.penumbraValue.textContent = movingLight.penumbra.toFixed(2);
  }

  if (shadowUI.biasInput) {
    // Sync slider to current moving light shadow bias at init
    if (movingLight?.shadow && typeof movingLight.shadow.bias === 'number') {
      shadowUI.biasInput.value = movingLight.shadow.bias.toString();
    }
    shadowUI.biasInput.addEventListener('input', () => {
      const v = parseFloat(shadowUI.biasInput.value);
      if (movingLight?.shadow) movingLight.shadow.bias = v; // only movingLight casts
      updateBiasDisplay();
    });
  }
  if (shadowUI.normalBiasInput) {
    shadowUI.normalBiasInput.addEventListener('input', () => {
      const v = parseFloat(shadowUI.normalBiasInput.value);
      if (movingLight?.shadow) movingLight.shadow.normalBias = v;
      updateBiasDisplay();
    });
  }
  if (shadowUI.penumbraInput) {
    shadowUI.penumbraInput.addEventListener('input', () => {
      const v = parseFloat(shadowUI.penumbraInput.value);
      if (movingLight?.isSpotLight) {
        movingLight.penumbra = v;
        updateBiasDisplay();
      }
    });
  }
  updateBiasDisplay();
}

function toggleAxes(){
  if (!axesHelper) {
    axesHelper = new THREE.AxesHelper(0.2);
    scene.add(axesHelper);
  } else {
    axesHelper.visible = !axesHelper.visible;
  }
}

function toggleWireframe(){
  scene.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { if ('wireframe' in m) m.wireframe = !m.wireframe; });
    }
  });
}

function toggleBounds(){
  if (boundsHelpers.length === 0) {
    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.computeBoundingBox();
        const box = new THREE.Box3().setFromObject(obj);
        const helper = new THREE.Box3Helper(box, 0x888888);
        boundsHelpers.push(helper);
        scene.add(helper);
      }
    });
  } else {
    const visible = !boundsHelpers[0].visible;
    boundsHelpers.forEach(h => h.visible = visible);
  }
}

function logMaterials(){
  const mats = new Set();
  scene.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => mats.add(m));
      else mats.add(obj.material);
    }
  });
  console.table([...mats].map((m,i) => ({ i, type: m.type, name: m.name || '', wireframe: !!m.wireframe })));
}

function toggleAmbient(btn){
  if (!ambientLight) {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    ambientLight.name = 'DebugAmbient';
    scene.add(ambientLight);
  } else {
    ambientLight.visible = !ambientLight.visible;
  }
  if (btn) btn.style.opacity = ambientLight.visible !== false ? '1' : '0.6';
}

function toggleBoost(btn){
  const lights = [lightBack, lightFront, movingLight].filter(l => l && l.isLight);
  if (!lights.length) return;
  if (!boosted) {
    lights.forEach(l => { l.intensity = (lightOriginalIntensity.get(l) ?? l.intensity) * 3.0; });
    boosted = true;
  } else {
    lights.forEach(l => { const base = lightOriginalIntensity.get(l); if (typeof base === 'number') l.intensity = base; });
    boosted = false;
  }
  if (btn) btn.style.opacity = boosted ? '1' : '0.6';
}

// Scale all known lights to a lower baseline (e.g., 0.03 ≈ 10× "Lights -")
function applyInitialLightScale(factor){
  const lights = [lightBack, lightFront, movingLight].filter(l => l && l.isLight);
  lights.forEach(l => { l.intensity = (lightOriginalIntensity.get(l) ?? l.intensity) * factor; });
}

function setAllLightsIntensity(value){
  const lights = [lightBack, lightFront, movingLight].filter(l => l && l.isLight);
  lights.forEach(l => { l.intensity = value; lightOriginalIntensity.set(l, value); });
}

// Move camera back along its view direction to fit a bit more on screen
function adjustCameraDistanceMultiplier(mult = 1.1){
  if (!camera) return;
  const target = (controls && controls.target) ? controls.target.clone() : (positionTarget ? positionTarget.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0,0,0));
  const dir = camera.getWorldDirection(new THREE.Vector3()); // camera forward
  const currentDist = camera.position.distanceTo(target);
  const newDist = currentDist * mult;
  const delta = newDist - currentDist;
  // Move opposite the forward direction to back away
  camera.position.addScaledVector(dir, -delta);
  camera.updateMatrixWorld();
}

// Log world positions of camera and light references for Blender parity checks
function logReferencePositions(){
  const fmt = (v) => `[${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}]`;
  console.info('[logoScene] Reference positions (hard-coded):', {
    camerareference1: fmt(REF.cam1),
    camerareference2: fmt(REF.cam2),
    camHome: fmt(REF.camHome),
    lightreference1: fmt(REF.light1),
    lightreference2: fmt(REF.light2)
  });
}

function setupShadows(){
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Only movingLight should cast shadows; disable on others
  [lightBack, lightFront].forEach(l => { if (l && l.isLight) { l.castShadow = false; if (l.shadow?.map) l.shadow.map.dispose(); } });
  if (movingLight && movingLight.isLight) {
    movingLight.castShadow = true;
    if (movingLight.shadow?.mapSize) movingLight.shadow.mapSize.set(2048, 2048);
    if (movingLight.shadow) {
      if (typeof movingLight.shadow.bias === 'number') movingLight.shadow.bias = 0.0015;
      if (typeof movingLight.shadow.normalBias === 'number') movingLight.shadow.normalBias = 0.0;
    }
    // Spot light tuning if applicable
    if (movingLight.isSpotLight) {
      movingLight.angle = Math.PI / 6; // narrower for crisper shadow
      movingLight.penumbra = 0.35;
      movingLight.decay = 2;
      movingLight.distance = 12;
      // Aim target at positionTarget or Dog for clear projection
      const targetObj = positionTarget || scene.getObjectByName('Dog');
      if (targetObj) {
        movingLight.target = targetObj;
      }
    }
  }

  // Default: only receive shadows; casting restricted to Dog later
  scene.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = true;
    }
  });
}

function addTestSpot(){
  // Add a strong SpotLight that is guaranteed to cast shadows onto Ground
  const spot = new THREE.SpotLight(0xffffff, 6.0, 20, Math.PI, 0.2, 2.0);
  spot.name = 'DebugSpot';
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = 0.01;
  spot.shadow.normalBias = 0.0;
  // Position above and behind the target; point at positionTarget or scene center
  spot.position.set(0.5, 2.0, 1.2);
  const target = new THREE.Object3D();
  target.name = 'DebugSpotTarget';
  if (positionTarget) {
    positionTarget.updateMatrixWorld();
    positionTarget.getWorldPosition(target.position);
  } else {
    target.position.set(0, 0, 0);
  }
  scene.add(target);
  spot.target = target;
  scene.add(spot);

  console.info('[logoScene] Added Debug SpotLight for shadow testing', {
    intensity: spot.intensity,
    angle: spot.angle,
    distance: spot.distance,
    bias: spot.shadow.bias,
    normalBias: spot.shadow.normalBias,
    mapSize: spot.shadow.mapSize.toArray(),
  });
}

// Ensure movingLight is a shadow-capable light; if not, replace with a SpotLight
function ensureMovingLightShadowCapable(){
  if (!movingLight || !movingLight.isLight) return;
  const canShadow = movingLight.isDirectionalLight || movingLight.isSpotLight || movingLight.isPointLight;
  if (canShadow) return; // already capable
  // Replace with a SpotLight positioned at current world position
  const worldPos = movingLight.getWorldPosition(new THREE.Vector3());
  const intensity = movingLight.intensity || 3;
  const spot = new THREE.SpotLight(0xffffff, intensity, 15, Math.PI/5, 0.3, 2);
  spot.name = 'MovingLightShadow';
  spot.position.copy(worldPos);
  // Set requested default shadow parameters
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = 0.0015;
  spot.shadow.normalBias = 0.0;
  // Aim at target or Dog
  const tgt = positionTarget || scene.getObjectByName('Dog') || new THREE.Object3D();
  if (!tgt.parent) scene.add(tgt);
  spot.target = tgt;
  scene.add(spot);
  movingLight.visible = false; // keep original for reference
  movingLight = spot; // update reference
  console.info('[logoScene] Replaced non-shadow light with SpotLight for movingLight');
}

function toggleMovingLightHelper(btn){
  if (!movingLight || !movingLight.isSpotLight) {
    console.warn('[logoScene] Moving light is not a SpotLight; cannot show helper');
    return;
  }
  if (!movingLightHelper) {
    movingLightHelper = new THREE.SpotLightHelper(movingLight);
    scene.add(movingLightHelper);
    movingLightHelper.visible = true;
  } else {
    movingLightHelper.visible = !movingLightHelper.visible;
  }
  if (btn) btn.style.opacity = movingLightHelper.visible ? '1' : '0.6';
  if (movingLightHelper.visible) movingLightHelper.update();
}

function replaceGroundMaterial(){
  const whiteGround = new THREE.ShadowMaterial({
    name: 'Ground_Std_White',
    opacity: 1.0
  });

  let replaced = 0;
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => {
        if (m && m.name === 'Ground') { replaced++; return whiteGround; }
        return m;
      });
    } else {
      if (obj.material.name === 'Ground') { obj.material = whiteGround; replaced++; }
    }

    // If this mesh uses the white ground material, set it to receive shadows only
    const usesWhite = Array.isArray(obj.material) ? obj.material.includes(whiteGround) : obj.material === whiteGround;
    if (usesWhite) {
      obj.castShadow = false;
      obj.receiveShadow = true;
    }
  });
  if (replaced > 0) console.info(`[logoScene] Replaced Ground materials: ${replaced}`);
}

function setupDogGroundShadows(){
  dogObj = scene.getObjectByName('Dog');
  const groundMeshes = [];
  scene.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      if (obj.material.name === 'Ground' || obj.material.name === 'Ground_Std_White') {
        groundMeshes.push(obj);
      }
    }
  });
  if (dogObj && dogObj.isMesh) {
    // Only the Dog should cast a shadow
    dogObj.castShadow = true;
    dogObj.receiveShadow = false;
  }
  groundMeshes.forEach(g => { g.receiveShadow = true; g.castShadow = false; });
  if (dogObj) console.info('[logoScene] Dog configured for shadow casting');
  if (groundMeshes.length) console.info(`[logoScene] Ground meshes configured to receive shadows: ${groundMeshes.length}`);
}

function cacheDogOriginalMaterials(){
  const dog = scene.getObjectByName('Dog');
  if (!dog) return;
  dog.traverse(obj => {
    if (obj.isMesh && obj.material) {
      dogOriginalMaterials.set(obj, obj.material);
    }
  });
  dogUsingOriginal = true;
}

function applyDogTestMaterial(){
  const dog = scene.getObjectByName('Dog');
  if (!dog) return;
  // Unlit material: no shading or light response
  const unlit = new THREE.MeshBasicMaterial({
    name: 'Dog_Unlit',
    color: 0x000000,
    toneMapped: false
  });
  dog.traverse(obj => { if (obj.isMesh) obj.material = unlit; });
  dogUsingOriginal = false;
  console.info('[logoScene] Dog switched to unlit MeshBasicMaterial (no light reaction)');
}

function restoreDogOriginalMaterials(){
  dogOriginalMaterials.forEach((mat, mesh) => {
    if (mesh.isMesh) mesh.material = mat;
  });
  dogUsingOriginal = true;
  console.info('[logoScene] Dog original materials restored');
}

function hookupDogMaterialToggle(){
  const btn = document.getElementById('dogMaterialToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (dogUsingOriginal) {
      applyDogTestMaterial();
      btn.style.opacity = '0.7';
    } else {
      restoreDogOriginalMaterials();
      btn.style.opacity = '1';
    }
  });
}

function updateMovingLight(dt){
  if (!movingLight) return;

  // Compute target world position between hard-coded refs by pointerX
  // If in logo menu region, use elevated third reference (lightreferenceLogofy simulated)
  let target;
  if (inMenuRegion) {
    target = REF.light2.clone();
    target.y += logoLightYOffset; // adjustable vertical offset
  } else {
    target = REF.light1.clone().lerp(REF.light2, pointerX);
  }

  // Convert to movingLight parent's local space for correct placement
  const parent = movingLight.parent || scene;
  movingTargetLocal.copy(target);
  parent.worldToLocal(movingTargetLocal);

  // Smoothly approach
  movingLight.position.lerp(movingTargetLocal, THREE.MathUtils.clamp(dt * 5, 0.05, 0.25));

  // If we're waiting for arrival at the menu (logofy) target, detect and trigger snap only on arrival
  if (inMenuRegion && awaitingLogofyArrival && !logofyArrived) {
    const worldPos = movingLight.getWorldPosition(new THREE.Vector3());
    const dist = worldPos.distanceTo(target);
    const arrived = dist < 0.03; // tolerance in world units
    if (arrived) {
      logofyArrived = true;
      awaitingLogofyArrival = false;
      // Snap camera to HOME pose: position at REF.camHome and orientation looking at positionTarget
      if (REF.camHome && camera) {
        const homePos = REF.camHome.clone();
        let look = new THREE.Vector3(0,0,0);
        if (positionTarget) {
          positionTarget.updateMatrixWorld();
          look = positionTarget.getWorldPosition(new THREE.Vector3());
        }
        const tmpObj = new THREE.Object3D();
        tmpObj.position.copy(homePos);
        tmpObj.lookAt(look);
        easeCameraTo(homePos, tmpObj.quaternion, 250);
      }
      // Delay then slow fade-in over 5s; last 1s turn off Dog shadow
      scheduleShadowShapeArrivalEffects();
    }
  }
}

// Smoothly follow the light with the camera position by lerping between cam1 and cam2 based on pointerX
// Disabled: automatic camera follow based on pointer; too confusing for UX
function updateAutoCamera(dt){ /* intentionally no-op */ }

let monoEnabled = false;
function toggleMonochrome(btn){
  // Apply a CSS filter to the canvas for quick monochrome preview
  if (!renderer) return;
  monoEnabled = !monoEnabled;
  if (invertEnabled) {
    renderer.domElement.style.filter = monoEnabled ? 'invert(1) grayscale(1) contrast(1.05)' : 'invert(1)';
  } else {
    renderer.domElement.style.filter = monoEnabled ? 'grayscale(1) contrast(1.05)' : '';
  }
  if (btn) btn.style.opacity = monoEnabled ? '1' : '0.6';
  console.info('[logoScene] Monochrome filter', monoEnabled ? 'enabled' : 'disabled');
}

function disableFilters(btn){
  if (!renderer) return;
  monoEnabled = false;
  // Keep invert if theme requires it
  renderer.domElement.style.filter = invertEnabled ? 'invert(1)' : '';
  if (btn) btn.style.opacity = '1';
  console.info('[logoScene] All canvas filters disabled');
}

function animate(){
  const dt = clock.getDelta();

  // Keep controls targeting the positionTarget; avoids fighting with controls by not calling camera.lookAt directly
  if (positionTarget && camera) {
    positionTarget.updateMatrixWorld();
    positionTarget.getWorldPosition(targetWorld);
    if (controls) controls.target.copy(targetWorld);
    else camera.lookAt(targetWorld);
  }

  updateMovingLight(dt);
  updateAutoCamera(dt);
  updateCameraTween();
  updateShadowFade();
  if (controls) controls.update();
  if (movingLightHelper && movingLightHelper.visible) movingLightHelper.update();

  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}

// ===================== FIT / BOUNDS =====================
function computeSceneBounds(){
  if (!glbRoot) return;
  sceneBoundingBox = new THREE.Box3().setFromObject(glbRoot);
  // Expand slightly to guarantee head clearance with subtle padding
  if (sceneBoundingBox) {
    const pad = 0.01 * sceneBoundingBox.getSize(new THREE.Vector3()).length();
    sceneBoundingBox.min.y -= pad * 0.25;
    sceneBoundingBox.max.y += pad * 0.25;
  }
  console.info('[logoScene] Scene bounds', sceneBoundingBox.min, sceneBoundingBox.max);
}

// Camera settings UI: apply lens/sensor and print camera values
function hookupCameraSettings(){
  const applyBtn = document.querySelector('[data-camera="apply-lens"]');
  const printBtn = document.querySelector('[data-camera="print"]');
  const lensInput = document.getElementById('camLens');
  const sensorHInput = document.getElementById('camSensorH');
  const fovOut = document.getElementById('camFovOut');
  const updateFovOut = () => { if (fovOut && camera?.isPerspectiveCamera) fovOut.textContent = camera.fov.toFixed(2); };

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      if (!camera || !camera.isPerspectiveCamera) return;
      const lens = Math.max(1e-3, parseFloat(lensInput?.value || '50'));
      const sensorH = Math.max(1e-3, parseFloat(sensorHInput?.value || '24'));
      const vFovRad = 2 * Math.atan((sensorH * 0.5) / lens);
      camera.fov = THREE.MathUtils.radToDeg(vFovRad);
      camera.updateProjectionMatrix();
      updateFovOut();
      console.info('[logoScene] Applied lens/sensor to camera', { lens_mm: lens, sensorH_mm: sensorH, fov_deg: camera.fov.toFixed(3) });
    });
  }
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      if (!camera) return;
      camera.updateMatrixWorld();
      const pos = camera.getWorldPosition(new THREE.Vector3());
      const quat = camera.getWorldQuaternion(new THREE.Quaternion());
      console.info('[logoScene] Camera values', {
        position: [pos.x.toFixed(4), pos.y.toFixed(4), pos.z.toFixed(4)],
        quaternion: [quat.x.toFixed(6), quat.y.toFixed(6), quat.z.toFixed(6), quat.w.toFixed(6)],
        fov_deg: camera.fov?.toFixed ? camera.fov.toFixed(3) : undefined,
        near: camera.near,
        far: camera.far
      });
      updateFovOut();
    });
  }
  // Initialize FOV readout
  updateFovOut();
}

function applyCameraLensSensorDefaults(lensMM, sensorHMM){
  if (!camera || !camera.isPerspectiveCamera) return;
  const vFovRad = 2 * Math.atan((sensorHMM * 0.5) / lensMM);
  camera.fov = THREE.MathUtils.radToDeg(vFovRad);
  camera.updateProjectionMatrix();
  // Update UI if present
  const lensInput = document.getElementById('camLens');
  const sensorHInput = document.getElementById('camSensorH');
  if (lensInput) lensInput.value = lensMM.toString();
  if (sensorHInput) sensorHInput.value = sensorHMM.toString();
  const fovOut = document.getElementById('camFovOut');
  if (fovOut) fovOut.textContent = camera.fov.toFixed(2);
  console.info('[logoScene] Default camera lens/sensor applied', { lensMM, sensorHMM, fovDeg: camera.fov.toFixed(3) });
}


// ===================== Beam angle and Logo light Y offset =====================
let logoLightYOffset = 0.5;
function hookupBeamAndLogoYOffset(){
  const angleSlider = document.getElementById('movingLightAngle');
  const yOffsetSlider = document.getElementById('logoLightYOffset');
  if (angleSlider) {
    angleSlider.addEventListener('input', () => {
      if (movingLight?.isSpotLight) {
        const deg = parseFloat(angleSlider.value);
        movingLight.angle = THREE.MathUtils.degToRad(deg);
      }
    });
    // Initialize
    if (movingLight?.isSpotLight) movingLight.angle = THREE.MathUtils.degToRad(parseFloat(angleSlider.value));
  }
  if (yOffsetSlider) {
    yOffsetSlider.addEventListener('input', () => {
      logoLightYOffset = parseFloat(yOffsetSlider.value);
    });
    logoLightYOffset = parseFloat(yOffsetSlider.value);
  }
}

// ===================== Collapse panels (Test button) =====================
function hookupTestCollapse(){
  const btn = document.getElementById('collapseTestPanels');
  const container = document.querySelector('#logoStage .controls-mini');
  if (!btn || !container) return;
  btn.addEventListener('click', () => {
    container.classList.toggle('collapsed');
  });
}

// ===================== Region detection (menu area) =====================
let inMenuRegion = false;
let awaitingLogofyArrival = false;
let logofyArrived = false;
function updateMenuRegion(e){
  // Nav starts at #menu; use its top position as cutoff
  const nav = document.getElementById('menu');
  if (!nav) return;
  const navRect = nav.getBoundingClientRect();
  const prev = inMenuRegion;
  inMenuRegion = e.clientY >= navRect.top; // pointer below nav top => menu region
  if (inMenuRegion && !prev) {
    // Entered menu: wait until moving light reaches logofy target before snapping
    awaitingLogofyArrival = true;
    logofyArrived = false;
    fadeShadowShapeTo(0, 120);
    if (dogObj && dogObj.isMesh) dogObj.castShadow = true;
  } else if (prev && !inMenuRegion) {
    // Leaving menu: reset flags and restore defaults
    awaitingLogofyArrival = false;
    logofyArrived = false;
    fadeShadowShapeTo(0, 120);
    cancelShadowShapeArrivalEffects();
    if (dogObj && dogObj.isMesh) dogObj.castShadow = true;
  }
}
window.addEventListener('pointermove', updateMenuRegion, { passive: true });

// (debug + self-heal defined earlier at top)

// ===================== Theme inversion post-process =====================
let invertEnabled = false;
function setInvertEnabled(on){
  invertEnabled = on;
  if (renderer?.domElement) {
    // CSS filter invert for post effect (doesn't touch materials)
    if (on) {
      renderer.domElement.style.filter = monoEnabled ? 'invert(1) grayscale(1) contrast(1.05)' : 'invert(1)';
    } else {
      renderer.domElement.style.filter = monoEnabled ? 'grayscale(1) contrast(1.05)' : '';
    }
    debugInvert('setInvertEnabled(' + on + ')');
  }
}

// Observe theme changes to toggle inversion
const themeObserver = new MutationObserver(() => {
  const theme = document.documentElement.getAttribute('data-theme');
  // Flip: when using dark theme for the site, invert Three.js to match black/white balance
  setInvertEnabled(theme === 'dark');
  // Trigger glitch burst on theme switch
  triggerGlitchBurst();
});
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ===================== Glitch effect on theme toggle =====================
let glitchTimerId = null;
function triggerGlitchBurst(){
  if (!camera) return;
  // Session-based burst to avoid late timers overriding final restore
  if (glitchTimerId) { clearTimeout(glitchTimerId); glitchTimerId = null; }
  const sessionId = performance.now() + Math.random();
  triggerGlitchBurst._currentSession = sessionId;
  const timers = [];

  const cancelTimers = () => { timers.forEach(id => clearTimeout(id)); };

  const restoreCameraHome = (force=false) => {
    if (!camera) return;
    // Use REF.camHome if defined; else fall back to cached original position/quaternion
    let homePos = REF.camHome ? REF.camHome.clone() : (cameraOriginalPos ? cameraOriginalPos.clone() : camera.position.clone());
    let look = new THREE.Vector3();
    if (positionTarget) {
      positionTarget.updateMatrixWorld();
      look = positionTarget.getWorldPosition(new THREE.Vector3());
    }
    const tmp = new THREE.Object3D();
    tmp.position.copy(homePos);
    tmp.lookAt(look);
    if (force) {
      camera.position.copy(homePos);
      camera.quaternion.copy(tmp.quaternion);
      camera.updateMatrixWorld();
    } else {
      easeCameraTo(homePos, tmp.quaternion, 220);
    }
    applyLensMM(1000);
  };

  burstGlitchActive = true;
  updateGlitchPassEnabled();

  const bursts = Math.floor(5 + Math.random() * 8); // 5-12 bursts
  let i = 0;
  const baseZ = REF.camHome?.z ?? camera.position.z;
  let ended = false;

  const makeOne = () => {
    if (ended) return; // already ended
    if (triggerGlitchBurst._currentSession !== sessionId) return; // superseded
    if (i >= bursts) return;
    i++;
    const t = Math.random();
    const base = REF.cam1.clone().lerp(REF.cam2, t);
    base.y = THREE.MathUtils.lerp(1, 8, Math.random());
    base.z = baseZ;
    const lens = 1000 + Math.random() * 1000;
    applyLensMM(lens);
    const tmpObj = new THREE.Object3D();
    let look = new THREE.Vector3(0,0,0);
    if (positionTarget) {
      positionTarget.updateMatrixWorld();
      look = positionTarget.getWorldPosition(new THREE.Vector3());
    }
    tmpObj.position.copy(base);
    tmpObj.lookAt(look);
    const dur = 50 + Math.random()*70;
    easeCameraTo(base, tmpObj.quaternion, dur);
    // schedule next
    glitchTimerId = setTimeout(makeOne, 40 + Math.random()*80);
    timers.push(glitchTimerId);
  };
  makeOne();

  const endAfter = 500 + Math.random()*700;
  const endTimer = setTimeout(() => {
    if (triggerGlitchBurst._currentSession !== sessionId) return; // superseded
    ended = true;
    burstGlitchActive = false;
    cancelTimers();
    restoreCameraHome(false); // tween home
    // Redundant forced correction after tween completes (~250ms) to fix any straggler updates
    const forceTimer = setTimeout(() => {
      if (triggerGlitchBurst._currentSession !== sessionId) return;
      restoreCameraHome(true); // force set
      updateGlitchPassEnabled();
    }, 300);
    timers.push(forceTimer);
    updateGlitchPassEnabled();
  }, endAfter);
  timers.push(endTimer);
}

function applyLensMM(lens){
  if (!camera?.isPerspectiveCamera) return;
  const sensorH = 30; // keep our default sensor height
  const vFovRad = 2 * Math.atan((sensorH * 0.5) / lens);
  camera.fov = THREE.MathUtils.radToDeg(vFovRad);
  camera.updateProjectionMatrix();
  const fovOut = document.getElementById('camFovOut');
  if (fovOut) fovOut.textContent = camera.fov.toFixed(2);
}

function fitSceneToView(options = {}){
  if (!sceneBoundingBox) computeSceneBounds();
  if (!sceneBoundingBox || !camera) return;
  const size = new THREE.Vector3();
  sceneBoundingBox.getSize(size);
  const center = new THREE.Vector3();
  sceneBoundingBox.getCenter(center);

  const paddingFactor = options.paddingFactor || 1.1;
  const headroomFactor = options.headroomFactor || 1.15;
  const verticalShift = options.verticalShift != null ? options.verticalShift : (size.y * 0.05);

  const fov = camera.fov * Math.PI / 180; // vertical fov
  const aspect = camera.aspect || 1;
  const halfHeight = size.y * 0.5;
  const halfWidth = size.x * 0.5;
  const distHeight = halfHeight / Math.tan(fov / 2);
  const distWidth = halfWidth / (Math.tan(fov / 2) * aspect);
  let dist = Math.max(distHeight * headroomFactor, distWidth) * paddingFactor;

  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);

  if (controls) {
    controls.target.copy(center);
    controls.target.y += verticalShift;
  }

  camera.near = Math.max(0.01, dist - size.length() * 2);
  camera.far = dist + size.length() * 3;
  camera.updateProjectionMatrix();
  console.info('[logoScene] FitScene distance', dist.toFixed(3), 'size', size.toArray().map(v=>v.toFixed(3)), 'aspect', aspect.toFixed(3));
}

// ===================== Camera tweening =====================
function easeCameraTo(targetPos, targetQuat, durationMs = 250){
  if (!camera) return;
  camTween = {
    startPos: camera.position.clone(),
    startQuat: camera.quaternion.clone(),
    endPos: targetPos.clone(),
    endQuat: targetQuat.clone(),
    t0: performance.now(),
    dur: Math.max(1, durationMs)
  };
}

function updateCameraTween(){
  if (!camTween) return;
  const now = performance.now();
  const t = THREE.MathUtils.clamp((now - camTween.t0) / camTween.dur, 0, 1);
  const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; // easeInOutCubic
  camera.position.copy(camTween.startPos).lerp(camTween.endPos, e);
  camera.quaternion.copy(camTween.startQuat).slerp(camTween.endQuat, e);
  if (t >= 1) camTween = null;
}

// ===================== ShadowShape fading =====================
function prepareShadowShape(root){
  const applyMat = (mesh) => {
    if (!mesh.isMesh) return;
    const mat = new THREE.MeshBasicMaterial({
      name: 'ShadowShape_Unlit',
      color: 0x000000,
      transparent: true,
      opacity: currentShadowOpacity,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    mesh.material = mat;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  };
  if (root.isMesh) applyMat(root);
  root.traverse(obj => { if (obj.isMesh) applyMat(obj); });
}

function fadeShadowShapeTo(targetOpacity, durationMs=150){
  if (!shadowShape) return;
  targetOpacity = THREE.MathUtils.clamp(targetOpacity, 0, 1);
  if (Math.abs((shadowFade?.end ?? currentShadowOpacity) - targetOpacity) < 0.02) return;
  shadowFade = { start: currentShadowOpacity, end: targetOpacity, t0: performance.now(), dur: Math.max(1, durationMs) };
}

function updateShadowFade(){
  if (!shadowFade || !shadowShape) return;
  const now = performance.now();
  const t = THREE.MathUtils.clamp((now - shadowFade.t0) / shadowFade.dur, 0, 1);
  const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2;
  currentShadowOpacity = THREE.MathUtils.lerp(shadowFade.start, shadowFade.end, e);
  shadowShape.traverse(obj => {
    if (obj.isMesh && obj.material && 'opacity' in obj.material) obj.material.opacity = currentShadowOpacity;
  });
  if (t >= 1) shadowFade = null;
}

// Schedule fade sequence when arriving at logofy: short delay, long fade, final shadow disable
function scheduleShadowShapeArrivalEffects(){
  // Invalidate any previous scheduled actions and start a new session
  const mySession = ++shadowArrivalSession;
  // Start long fade after small delay
  if (shadowFadeStartTimerId) { clearTimeout(shadowFadeStartTimerId); shadowFadeStartTimerId = null; }
  if (shadowDisableTimerId) { clearTimeout(shadowDisableTimerId); shadowDisableTimerId = null; }
  shadowFadeStartTimerId = setTimeout(() => {
    if (mySession !== shadowArrivalSession) return; // canceled
    fadeShadowShapeTo(1, 5000); // long 5s fade
  }, 300);
  // Disable Dog shadow in last second of fade (300ms + 4000ms)
  shadowDisableTimerId = setTimeout(() => {
    if (mySession !== shadowArrivalSession) return; // canceled or superseded
    if (!inMenuRegion) return; // only if still in menu context
    if (dogObj && dogObj.isMesh) dogObj.castShadow = false;
  }, 4300);
}

function cancelShadowShapeArrivalEffects(){
  shadowArrivalSession++; // invalidate current session
  if (shadowFadeStartTimerId) { clearTimeout(shadowFadeStartTimerId); shadowFadeStartTimerId = null; }
  if (shadowDisableTimerId) { clearTimeout(shadowDisableTimerId); shadowDisableTimerId = null; }
}
