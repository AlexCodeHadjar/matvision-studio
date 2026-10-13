import {
  DataTexture,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type WebGLRenderer,
} from 'three';

/** Bake the existing print layout, cloth tint and linear supplier profile without any lighting. */
export function bakePrint(
  renderer: WebGLRenderer,
  original: MeshPhysicalMaterial,
  width: number,
  height: number,
) {
  const material = new MeshBasicMaterial({
    map: original.map,
    color: original.color,
    toneMapped: false,
  });
  material.onBeforeCompile = original.onBeforeCompile;
  material.customProgramCacheKey = () => original.customProgramCacheKey() + '|photo-albedo-v1';
  try {
    return bakeQuad(renderer, material, width, height, LinearSRGBColorSpace);
  } finally {
    material.dispose();
  }
}

function bakeQuad(
  renderer: WebGLRenderer,
  material: MeshBasicMaterial | ShaderMaterial,
  width: number,
  height: number,
  colorSpace: typeof NoColorSpace | typeof LinearSRGBColorSpace,
) {
  const target = new WebGLRenderTarget(width, height, { depthBuffer: false });
  target.texture.colorSpace = LinearSRGBColorSpace;
  const geometry = new PlaneGeometry(2, 2),
    scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const saved = {
    target: renderer.getRenderTarget(),
    mapping: renderer.toneMapping,
    auto: renderer.autoClear,
  };
  try {
    renderer.toneMapping = NoToneMapping;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    const texture = new DataTexture(pixels, width, height, RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
    return texture;
  } finally {
    renderer.setRenderTarget(saved.target);
    renderer.toneMapping = saved.mapping;
    renderer.autoClear = saved.auto;
    geometry.dispose();
    target.dispose();
  }
}

/** Convert the height shading hook to a standard tangent-space map for the path tracer. */
export function bakeRelief(
  renderer: WebGLRenderer,
  material: MeshStandardMaterial,
  widthMm: number,
  heightMm: number,
  resolution: number,
) {
  const normal = material.normalMap!,
    height = material.bumpMap!;
  const image = height.image as { width: number; height: number };
  normal.updateMatrix();
  height.updateMatrix();
  const shader = new ShaderMaterial({
    uniforms: {
      normalMap: { value: normal },
      heightMap: { value: height },
      normalTransform: { value: normal.matrix.clone() },
      heightTransform: { value: height.matrix.clone() },
      normalScale: { value: material.normalScale.clone() },
      delta: { value: new Vector2(1 / image.width, 1 / image.height) },
      heightSlope: {
        value: new Vector2(
          (material.bumpScale * height.repeat.x) / (widthMm / 1000),
          (material.bumpScale * height.repeat.y) / (heightMm / 1000),
        ),
      },
    },
    vertexShader:
      'varying vec2 photoUv; void main(){photoUv=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `varying vec2 photoUv;
      uniform sampler2D normalMap, heightMap; uniform mat3 normalTransform, heightTransform;
      uniform vec2 normalScale, delta, heightSlope;
      void main(){
        vec2 uvH=(heightTransform*vec3(photoUv,1.0)).xy;
        vec3 n=texture2D(normalMap,(normalTransform*vec3(photoUv,1.0)).xy).xyz*2.0-1.0;
        n.xy*=normalScale;
        vec2 grad=vec2(texture2D(heightMap,uvH+vec2(delta.x,0)).r-texture2D(heightMap,uvH-vec2(delta.x,0)).r,
          texture2D(heightMap,uvH+vec2(0,delta.y)).r-texture2D(heightMap,uvH-vec2(0,delta.y)).r)/(2.0*delta);
        n=normalize(vec3(n.xy/max(n.z,0.01)-grad*heightSlope,1.0));
        gl_FragColor=vec4(n*0.5+0.5,1.0);
      }`,
  });
  try {
    return bakeQuad(renderer, shader, resolution, resolution, NoColorSpace);
  } finally {
    shader.dispose();
  }
}
