import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// The post stack. Order matters: OutputPass applies tone mapping and the output
// colour space, so everything after it is display-referred. SMAA's edge detection
// works on perceptual luma — run it on linear HDR values and it misses most edges
// while over-detecting in highlights. So SMAA comes AFTER OutputPass, never before.
export function makeComposer(engine) {
  const { renderer, scene, camera } = engine;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // HalfFloatType so a bloom threshold above 1.0 means anything (values > 1 survive
  // the render target). samples: 0 — no MSAA; combining a multisampled target with
  // a DepthTexture depends on blit behaviour that changed in r168. SMAA is the AA.
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, target);
  // Normalize _width/_height to the logical size; the targets then track the
  // renderer's pixel ratio through setPixelRatio/setSize.
  composer.setSize(w, h);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const output = new OutputPass();
  composer.addPass(output);

  const smaa = new SMAAPass(w, h);
  composer.addPass(smaa);

  return {
    render: () => composer.render(),
    setSize: (width, height) => composer.setSize(width, height),
    setPixelRatio: (pr) => composer.setPixelRatio(pr),
    passes: composer.passes,
    renderPass, output, smaa, composer,
  };
}
