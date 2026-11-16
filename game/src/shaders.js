// shaders.js — every hand-written GLSL block in the game, kept as data
// in one module so the whole set can be compile-checked headlessly
// (desktop GLSL and ES 3.00 forms) without booting the game. The
// discipline: one coordinate space per lighting sum, interpolated
// directions re-normalized in the fragment stage, branchless
// mix/step/smoothstep shaping — edges never reversed; a falloff that
// runs the other way is written 1.0 - s.

export const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, .0, 1.0);
}
`;

export const POST_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uVignette; // 0 = no vignette, 1 = full
uniform float uFlash;    // flashbang white-out, 0..1
uniform float uHurt;     // damage vignette strength, 0..1
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 col = texture2D(tDiffuse, vUv);
  vec2 d = vUv - vec2(.5);
  float dist2 = dot(d, d);

  // Vignette: with uVignette = 0 the factor is exactly 1.0 — unchanged.
  float vigCurve = 1.0 - smoothstep(.18, .85, dist2 * 1.9);
  float vig = mix(1.0, mix(.68, 1.0, vigCurve), uVignette);
  col.rgb *= vig;

  // Warm sodium grade: shadows lean amber, highlights stay honest.
  float lum = dot(col.rgb, vec3(.299, .587, .114));
  vec3 warmed = col.rgb * vec3(1.07, .99, .89);
  col.rgb = mix(col.rgb, warmed, (1.0 - lum) * .38);

  // A breath of animated grain so the night never looks airbrushed.
  col.rgb += (hash12(vUv * (311.0 + fract(uTime) * 97.0)) - .5) * .026;

  // Damage vignette: red pressure at the frame edge.
  float edge = smoothstep(.06, .5, dist2);
  col.rgb = mix(col.rgb, vec3(.5, .03, .02), edge * uHurt * .6);

  // Flashbang white-out.
  col.rgb = mix(col.rgb, vec3(1.0), clamp(uFlash, .0, 1.0));

  // The scene pass renders linear into the target, so the finish
  // happens here, once: ACES (Narkowicz fit) + exact sRGB encode.
  vec3 x = col.rgb * 1.04;
  col.rgb = clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), .0, 1.0);
  vec3 lo = col.rgb * 12.92;
  vec3 hi = 1.055 * pow(col.rgb, vec3(1.0 / 2.4)) - .055;
  col.rgb = mix(lo, hi, step(.0031308, col.rgb));

  gl_FragColor = col;
}
`;

export const RAIN_VERT = /* glsl */`
attribute float aSeed;
uniform float uTime;
uniform vec3 uCamPos;
varying float vFade;
void main() {
  // Fall inside a 96 x 42 x 72 box wrapped around the camera: endless
  // rain, never simulated per drop.
  float speed = 15.0 + aSeed * 10.0;
  float fall = mod(position.y - uTime * speed, 42.0);
  vec3 world = vec3(position.x, fall, position.z);
  world.x = uCamPos.x + mod(world.x - uCamPos.x + 48.0, 96.0) - 48.0;
  world.z = uCamPos.z + mod(world.z - uCamPos.z + 36.0, 72.0) - 36.0;
  world.x += (42.0 - fall) * .13; // the wind slant, growing as it falls
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(.1, -mv.z);
  gl_PointSize = clamp(300.0 / dist, 1.0, 20.0) * (.7 + aSeed * .6);
  vFade = (1.0 - smoothstep(28.0, 58.0, dist)) * smoothstep(.8, 3.5, dist);
}
`;

export const RAIN_FRAG = /* glsl */`
uniform sampler2D tStreak;
uniform vec3 uTint;
varying float vFade;
void main() {
  float a = texture2D(tStreak, gl_PointCoord).a;
  gl_FragColor = vec4(uTint, a * .38 * vFade);
}
`;

export const PUDDLE_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PUDDLE_FRAG = /* glsl */`
uniform vec3 uCamPos;
uniform vec4 uLamps[4]; // xyz: lamp position, w: strength
uniform vec3 uLampColor;
uniform vec3 uSkyColor;
varying vec3 vWorld;
void main() {
  vec3 viewDir = normalize(uCamPos - vWorld);
  // A puddle's normal is up, breathed on by two crossed ripple sines.
  float rip = sin(vWorld.x * 7.1) * sin(vWorld.z * 6.3) * .035;
  vec3 n = normalize(vec3(rip, 1.0, rip * .6));
  float fres = pow(1.0 - clamp(dot(n, viewDir), .0, 1.0), 3.0);
  vec3 col = uSkyColor * .4;
  for (int i = 0; i < 4; i++) {
    vec3 toLamp = uLamps[i].xyz - vWorld;
    float d = length(toLamp);
    vec3 l = toLamp / max(d, .001);
    vec3 hv = normalize(l + viewDir);
    float spec = pow(clamp(dot(n, hv), .0, 1.0), 110.0);
    // Stretch the glint toward the viewer: widen the lobe where the
    // half-vector runs flat to the surface.
    float flat_ = 1.0 - clamp(hv.y, .0, 1.0);
    spec += pow(clamp(dot(n, hv), .0, 1.0), 18.0) * flat_ * .35;
    float atten = uLamps[i].w / (1.0 + d * d * .014);
    col += uLampColor * spec * atten;
  }
  float alpha = clamp(.22 + fres * .78, .0, 1.0) * .88;
  gl_FragColor = vec4(col, alpha);
}
`;

// The fresnel rim injected into the soldiers' standard material: a
// silhouette glow in the team colour. `normal` and `vViewPosition` are
// the standard material's own values at the injection point.
export const RIM_FRAG_CHUNK = /* glsl */`
{
  vec3 rimViewDir = normalize(vViewPosition);
  float rimF = pow(1.0 - clamp(dot(normal, rimViewDir), .0, 1.0), 2.6);
  totalEmissiveRadiance += uRimColor * (rimF * .55);
}
`;
