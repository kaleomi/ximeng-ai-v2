/* ============================================================
 * fluid-background.js
 * WebGL2 GPU 流体模拟背景（源自 vibex.runninghub.cn 创作台辉光版）
 * 独立版本：无 React 依赖，纯原生 JS
 * 特性：鼠标/触摸滑动激起流体光影、自动动画、设置面板、
 *       🌅黄金时刻 / 🌈全彩 两种配色、Bloom 泛光、3D 墨彩光照
 * 用法：<script src="/fluid-background.js"></script>
 *       自动挂载全屏画布，或手动 window.fluidBackground.init(el)
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 顶点着色器 ---------- */
  var Us = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 texelSize;
void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  /* ---------- Splat：注入流体 ---------- */
  var Gs = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture(uTarget, vUv).xyz;
    fragColor = vec4(base + splat, 1.0);
}`;

  /* ---------- Divergence：散度 ---------- */
  var Ks = `#version 300 es
precision mediump float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uVelocity;
void main () {
    float L = texture(uVelocity, vL).x;
    float R = texture(uVelocity, vR).x;
    float T = texture(uVelocity, vT).y;
    float B = texture(uVelocity, vB).y;
    vec2 C = texture(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }
    float div = 0.5 * (R - L + T - B);
    fragColor = vec4(div, 0.0, 0.0, 1.0);
}`;

  /* ---------- Curl：旋度 ---------- */
  var qs = `#version 300 es
precision mediump float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uVelocity;
void main () {
    float L = texture(uVelocity, vL).y;
    float R = texture(uVelocity, vR).y;
    float T = texture(uVelocity, vT).x;
    float B = texture(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}`;

  /* ---------- Vorticity：涡量 ---------- */
  var Js = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
    float L = texture(uCurl, vL).x;
    float R = texture(uCurl, vR).x;
    float T = texture(uCurl, vT).x;
    float B = texture(uCurl, vB).x;
    float C = texture(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 vel = texture(uVelocity, vUv).xy;
    vel += force * dt;
    vel = min(max(vel, -1000.0), 1000.0);
    fragColor = vec4(vel, 0.0, 1.0);
}`;

  /* ---------- Pressure：压力泊松求解 ---------- */
  var Ys = `#version 300 es
precision mediump float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
    float L = texture(uPressure, vL).x;
    float R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x;
    float B = texture(uPressure, vB).x;
    float divergence = texture(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

  /* ---------- Gradient Subtract：梯度减法 ---------- */
  var Xs = `#version 300 es
precision mediump float;
precision mediump sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
    float L = texture(uPressure, vL).x;
    float R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x;
    float B = texture(uPressure, vB).x;
    vec2 velocity = texture(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    fragColor = vec4(velocity, 0.0, 1.0);
}`;

  /* ---------- Clear：清空 ---------- */
  var Zs = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform float value;
void main () {
    fragColor = value * texture(uTexture, vUv);
}`;

  /* ---------- Bloom Prefilter：泛光预过滤 ---------- */
  var Qs = `#version 300 es
precision mediump float;
precision mediump sampler2D;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec3 curve;
uniform float threshold;
void main () {
    vec3 c = texture(uTexture, vUv).rgb;
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - curve.x, 0.0, curve.y);
    rq = curve.z * rq * rq;
    c *= max(rq, br - threshold) / max(br, 0.0001);
    fragColor = vec4(c, 0.0);
}`;

  /* ---------- Bloom Blur：泛光模糊 ---------- */
  var $s = `#version 300 es
precision mediump float;
precision mediump sampler2D;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uTexture;
void main () {
    vec4 sum = vec4(0.0);
    sum += texture(uTexture, vL);
    sum += texture(uTexture, vR);
    sum += texture(uTexture, vT);
    sum += texture(uTexture, vB);
    sum *= 0.25;
    fragColor = sum;
}`;

  /* ---------- Bloom Final：泛光合成 ---------- */
  var ec = `#version 300 es
precision mediump float;
precision mediump sampler2D;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform float intensity;
void main () {
    vec4 sum = vec4(0.0);
    sum += texture(uTexture, vL);
    sum += texture(uTexture, vR);
    sum += texture(uTexture, vT);
    sum += texture(uTexture, vB);
    sum *= 0.25;
    fragColor = sum * intensity;
}`;

  /* ---------- Display：显示（3D 墨彩光照 + Bloom） ---------- */
  var tc = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform vec2 texelSize;

vec3 linearToGamma (vec3 color) {
    color = max(color, vec3(0.0));
    return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0.0));
}

void main () {
    vec3 c = texture(uTexture, vUv).rgb;

    // Shading — gradient-based 3D inky lighting
    vec3 lc = texture(uTexture, vL).rgb;
    vec3 rc = texture(uTexture, vR).rgb;
    vec3 tc = texture(uTexture, vT).rgb;
    vec3 bc = texture(uTexture, vB).rgb;
    float dx = length(rc) - length(lc);
    float dy = length(tc) - length(bc);
    vec3 n = normalize(vec3(dx, dy, length(texelSize)));
    vec3 l = vec3(0.0, 0.0, 1.0);
    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
    c *= diffuse;

    // Bloom — additive glow on bright areas
    vec3 bloom = texture(uBloom, vUv).rgb;
    bloom = linearToGamma(bloom);
    c += bloom;

    float a = max(c.r, max(c.g, c.b));
    fragColor = vec4(c, a);
}`;

  /* ---------- GL 辅助函数 ---------- */
  function nc(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
    }
    return s;
  }
  function rc(gl, vert, frag) {
    var v = nc(gl, gl.VERTEX_SHADER, vert);
    var f = nc(gl, gl.FRAGMENT_SHADER, frag);
    var p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
    }
    var uniforms = {};
    var count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var t = 0; t < count; t++) {
      var u = gl.getActiveUniform(p, t);
      uniforms[u.name] = gl.getUniformLocation(p, u.name);
    }
    return { program: p, uniforms: uniforms };
  }
  function ic(gl, w, h, internalFormat, format, type, filter) {
    gl.activeTexture(gl.TEXTURE0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: tex, fbo: fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: function (slot) {
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        return slot;
      }
    };
  }
  function ac(gl, w, h, internalFormat, format, type, filter) {
    var a = ic(gl, w, h, internalFormat, format, type, filter);
    var b = ic(gl, w, h, internalFormat, format, type, filter);
    return {
      width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
      get read() { return a; },
      get write() { return b; },
      swap: function () { var t = a; a = b; b = t; }
    };
  }
  function oc(gl, fbo, buffer) {
    if (fbo === null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, fbo.width, fbo.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function sc(h, s, v) {
    var r = 0, g = 0, b = 0;
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return { r: r, g: g, b: b };
  }
  function cc(goldenHour) {
    var c = sc(goldenHour ? 0.04 + Math.random() * 0.12 : Math.random(), 1, 1);
    return { r: c.r * 0.15, g: c.g * 0.15, b: c.b * 0.15 };
  }
  function lc(v) { return Math.floor(v * (window.devicePixelRatio || 1)); }
  function uc(gl, size) {
    var n = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (n < 1) n = 1 / n;
    var w = Math.round(size), h = Math.round(size * n);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: w, height: h } : { width: h, height: w };
  }

  /* ---------- 流体引擎主函数 ---------- */
  function initFluidBackground(canvas) {
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: false });
    if (!gl) {
      console.warn('WebGL2 不可用，流体背景已跳过');
      return null;
    }
    gl.getExtension('EXT_color_buffer_float');
    var filter = gl.getExtension('OES_texture_float_linear') ? gl.LINEAR : gl.NEAREST;

    // 画布尺寸（适配 DPR）
    function fitSize() {
      var w = lc(canvas.clientWidth), h = lc(canvas.clientHeight);
      if (w > 0 && h > 0) { canvas.width = w; canvas.height = h; }
    }
    fitSize();

    // 编译所有程序
    var progs = {
      advection: rc(gl, Us, Ws()),
      splat: rc(gl, Us, Gs),
      divergence: rc(gl, Us, Ks),
      curl: rc(gl, Us, qs),
      vorticity: rc(gl, Us, Js),
      pressure: rc(gl, Us, Ys),
      gradientSubtract: rc(gl, Us, Xs),
      clear: rc(gl, Us, Zs),
      bloomPrefilter: rc(gl, Us, Qs),
      bloomBlur: rc(gl, Us, $s),
      bloomFinal: rc(gl, Us, ec),
      display: rc(gl, Us, tc)
    };

    // 全屏四边形顶点缓冲
    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW);

    // 纹理：速度场（128）、密度场（1024）、散度/压力（128）、Bloom（256+8级）
    var sz = uc(gl, 128);
    var vel = ac(gl, sz.width, sz.height, gl.RG16F, gl.RG, gl.HALF_FLOAT, filter);
    var den = ac(gl, uc(gl, 1024).width, uc(gl, 1024).height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, filter);
    var divTex = ic(gl, sz.width, sz.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    var curlTex = ic(gl, sz.width, sz.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    var pressure = ac(gl, sz.width, sz.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);

    var bloomStrength = 0.6;
    var bloomSize = uc(gl, 256);
    var bloom = ic(gl, bloomSize.width, bloomSize.height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, filter);
    var bloomLevels = [];
    for (var i = 0; i < 8; i++) {
      var w = bloomSize.width >> (i + 1);
      var h = bloomSize.height >> (i + 1);
      if (w < 2 || h < 2) break;
      bloomLevels.push(ic(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, filter));
    }

    // 参数（可被外部覆盖）
    var params = {
      densityDissipation: 1, velocityDissipation: 0.2,
      pressure: 0.8, pressureIterations: 20,
      curl: 30, splatRadius: 0.25, splatForce: 6000,
      colorUpdateSpeed: 10, goldenHour: false
    };

    /* ---------- Bloom 泛光渲染 ---------- */
    function renderBloom(src, dest) {
      if (bloomLevels.length < 2) return;
      var last = dest;
      gl.disable(gl.BLEND);
      var r = bloomStrength * 0.7 + 0.0001;
      gl.useProgram(progs.bloomPrefilter.program);
      gl.uniform3f(progs.bloomPrefilter.uniforms.curve, 0.1799, 0.8402, 0.5950964056177102);
      gl.uniform1f(progs.bloomPrefilter.uniforms.threshold, bloomStrength);
      gl.uniform1i(progs.bloomPrefilter.uniforms.uTexture, src.attach(0));
      oc(gl, last, quad);
      gl.useProgram(progs.bloomBlur.program);
      for (var i = 0; i < bloomLevels.length; i++) {
        var lv = bloomLevels[i];
        gl.uniform2f(progs.bloomBlur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(progs.bloomBlur.uniforms.uTexture, last.attach(0));
        oc(gl, lv, quad);
        last = lv;
      }
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.enable(gl.BLEND);
      for (var i = bloomLevels.length - 2; i >= 0; i--) {
        var lv = bloomLevels[i];
        gl.uniform2f(progs.bloomBlur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(progs.bloomBlur.uniforms.uTexture, last.attach(0));
        oc(gl, lv, quad);
        last = lv;
      }
      gl.disable(gl.BLEND);
      gl.useProgram(progs.bloomFinal.program);
      gl.uniform2f(progs.bloomFinal.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(progs.bloomFinal.uniforms.uTexture, last.attach(0));
      gl.uniform1f(progs.bloomFinal.uniforms.intensity, 0.8);
      oc(gl, dest, quad);
    }

    /* ---------- 流体 Splat（溅射） ---------- */
    var pointers = [{
      id: -1, texcoordX: 0.5, texcoordY: 0.5,
      prevTexcoordX: 0.5, prevTexcoordY: 0.5,
      deltaX: 0, deltaY: 0, down: false, moved: false,
      color: cc(false)
    }];

    function aspectNorm(v) {
      var t = canvas.width / canvas.height;
      return t > 1 ? v * t : v;
    }
    function splat(x, y, dx, dy, color, forceMul) {
      var s = progs.splat;
      var radius = aspectNorm(params.splatRadius * (forceMul || 1) / 100);
      gl.useProgram(s.program);
      gl.uniform1i(s.uniforms.uTarget, vel.read.attach(0));
      gl.uniform1f(s.uniforms.aspectRatio, canvas.width / canvas.height);
      gl.uniform2f(s.uniforms.point, x, y);
      gl.uniform3f(s.uniforms.color, dx, dy, 0);
      gl.uniform1f(s.uniforms.radius, radius);
      oc(gl, vel.write, quad);
      vel.swap();
      gl.uniform1i(s.uniforms.uTarget, den.read.attach(0));
      gl.uniform3f(s.uniforms.color, color.r, color.g, color.b);
      gl.uniform1f(s.uniforms.radius, radius);
      oc(gl, den.write, quad);
      den.swap();
    }

    /* ---------- 流体求解（advection / curl / pressure ...） ---------- */
    function solveStep(dt) {
      gl.disable(gl.BLEND);
      var p = params;
      // curl
      gl.useProgram(progs.curl.program);
      gl.uniform2f(progs.curl.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
      gl.uniform1i(progs.curl.uniforms.uVelocity, vel.read.attach(0));
      oc(gl, curlTex, quad);
      // vorticity
      gl.useProgram(progs.vorticity.program);
      gl.uniform2f(progs.vorticity.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
      gl.uniform1i(progs.vorticity.uniforms.uVelocity, vel.read.attach(0));
      gl.uniform1i(progs.vorticity.uniforms.uCurl, curlTex.attach(1));
      gl.uniform1f(progs.vorticity.uniforms.curl, p.curl);
      gl.uniform1f(progs.vorticity.uniforms.dt, dt);
      oc(gl, vel.write, quad);
      vel.swap();
      // divergence
      gl.useProgram(progs.divergence.program);
      gl.uniform2f(progs.divergence.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
      gl.uniform1i(progs.divergence.uniforms.uVelocity, vel.read.attach(0));
      oc(gl, divTex, quad);
      // clear pressure
      gl.useProgram(progs.clear.program);
      gl.uniform1i(progs.clear.uniforms.uTexture, pressure.read.attach(0));
      gl.uniform1f(progs.clear.uniforms.value, p.pressure);
      oc(gl, pressure.write, quad);
      pressure.swap();
      // pressure solve
      gl.useProgram(progs.pressure.program);
      gl.uniform2f(progs.pressure.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
      gl.uniform1i(progs.pressure.uniforms.uDivergence, divTex.attach(0));
      for (var i = 0; i < p.pressureIterations; i++) {
        gl.uniform1i(progs.pressure.uniforms.uPressure, pressure.read.attach(1));
        oc(gl, pressure.write, quad);
        pressure.swap();
      }
      // gradient subtract
      gl.useProgram(progs.gradientSubtract.program);
      gl.uniform2f(progs.gradientSubtract.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
      gl.uniform1i(progs.gradientSubtract.uniforms.uPressure, pressure.read.attach(0));
      gl.uniform1i(progs.gradientSubtract.uniforms.uVelocity, vel.read.attach(1));
      oc(gl, vel.write, quad);
      vel.swap();
      // advect velocity
      gl.useProgram(progs.advection.program);
      gl.uniform2f(progs.advection.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
      gl.uniform1i(progs.advection.uniforms.uVelocity, vel.read.attach(0));
      gl.uniform1i(progs.advection.uniforms.uSource, vel.read.attach(0));
      gl.uniform1f(progs.advection.uniforms.dt, dt);
      gl.uniform1f(progs.advection.uniforms.dissipation, p.velocityDissipation);
      oc(gl, vel.write, quad);
      vel.swap();
      // advect density
      gl.uniform1i(progs.advection.uniforms.uVelocity, vel.read.attach(0));
      gl.uniform1i(progs.advection.uniforms.uSource, den.read.attach(1));
      gl.uniform1f(progs.advection.uniforms.dissipation, p.densityDissipation);
      oc(gl, den.write, quad);
      den.swap();
    }

    /* ---------- 显示（bloom + 3D 光照） ---------- */
    function render() {
      renderBloom(den.read, bloom);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(progs.display.program);
      gl.uniform2f(progs.display.uniforms.texelSize,
        1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
      gl.uniform1i(progs.display.uniforms.uTexture, den.read.attach(0));
      gl.uniform1i(progs.display.uniforms.uBloom, bloom.attach(1));
      oc(gl, null, quad);
    }

  /* ---------- Advection：平流 ---------- */
  function Ws() {
    return `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
void main () {
    vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
    vec4 result = texture(uSource, coord);
    float decay = 1.0 + dissipation * dt;
    fragColor = result / decay;
}`;
  }

  /* ---------- 主循环 ---------- */
  var lastTime = Date.now();
  var colorAccum = 0;
  var lastMoved = Date.now();
  var idleTimer = 0;
  var idleInterval = 0.8;
  var rafId = 0;

  function resizeCanvas() {
    var w = lc(canvas.clientWidth), h = lc(canvas.clientHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function frame() {
    var now = Date.now();
    var dt = Math.min((now - lastTime) / 1000, 0.016666);
    lastTime = now;
    resizeCanvas();
    colorAccum += dt * params.colorUpdateSpeed;
    if (colorAccum >= 1) {
      colorAccum = 0;
      for (var i = 0; i < pointers.length; i++) {
        pointers[i].color = cc(params.goldenHour);
      }
    }
    // 指针移动 → 溅射
    var anyMoved = false;
    for (var i = 0; i < pointers.length; i++) {
      var pt = pointers[i];
      if (pt.moved) {
        anyMoved = true;
        pt.moved = false;
        var fx = pt.deltaX * params.splatForce;
        var fy = pt.deltaY * params.splatForce;
        splat(pt.texcoordX, pt.texcoordY, fx, fy, pt.color);
      }
    }
    if (anyMoved) lastMoved = now;
    // 空闲自动溅射（模拟流动）
    if (now - lastMoved > 800) {
      idleTimer += dt;
      if (idleTimer >= idleInterval) {
        idleTimer = 0;
        idleInterval = 0.5 + Math.random() * 0.9;
        var n = 1 + Math.floor(Math.random() * 2);
        for (var j = 0; j < n; j++) {
          var c = cc(params.goldenHour);
          c.r *= 9; c.g *= 9; c.b *= 9;
          var angle = Math.random() * Math.PI * 2;
          var force = 350 + Math.random() * 550;
          splat(Math.random(), Math.random(),
            Math.cos(angle) * force, Math.sin(angle) * force, c, 1.6 + Math.random());
        }
      }
    } else {
      idleTimer = 0;
    }
    solveStep(dt);
    render();
    rafId = requestAnimationFrame(frame);
  }

  // 初始随机溅射几处
  var initCount = Math.floor(Math.random() * 10) + 8;
  for (var i = 0; i < initCount; i++) {
    var c = cc(false);
    c.r *= 10; c.g *= 10; c.b *= 10;
    splat(Math.random(), Math.random(),
      1000 * (Math.random() - 0.5), 1000 * (Math.random() - 0.5), c);
  }
  rafId = requestAnimationFrame(frame);

  /* ---------- 交互 ---------- */
  function toTexcoord(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / canvas.clientWidth,
      y: 1 - (clientY - rect.top) / canvas.clientHeight
    };
  }
  function updatePointer(pt, clientX, clientY) {
    var tc2 = toTexcoord(clientX, clientY);
    var ar = canvas.width / canvas.height;
    pt.prevTexcoordX = pt.texcoordX;
    pt.prevTexcoordY = pt.texcoordY;
    pt.texcoordX = tc2.x;
    pt.texcoordY = tc2.y;
    var dx = tc2.x - pt.prevTexcoordX;
    var dy = tc2.y - pt.prevTexcoordY;
    if (ar < 1) dx *= ar;
    if (ar > 1) dy /= ar;
    pt.deltaX = dx;
    pt.deltaY = dy;
    pt.moved = Math.abs(dx) > 0 || Math.abs(dy) > 0;
  }
  function onMove(e) {
    updatePointer(pointers[0], e.clientX, e.clientY);
  }
  function onDown(e) {
    pointers[0].down = true;
    pointers[0].color = cc(params.goldenHour);
    updatePointer(pointers[0], e.clientX, e.clientY);
  }
  function onUp() { pointers[0].down = false; }
  function onTouchStart(e) {
    var touches = e.targetTouches;
    for (var i = 0; i < touches.length; i++) {
      var t = touches[i];
      var pt = pointers.find(function (x) { return x.id === t.identifier; });
      if (!pt) {
        pt = {
          id: t.identifier, texcoordX: 0, texcoordY: 0,
          prevTexcoordX: 0, prevTexcoordY: 0,
          deltaX: 0, deltaY: 0, down: false, moved: false,
          color: cc(params.goldenHour)
        };
        pointers.push(pt);
      }
      pt.down = true;
      updatePointer(pt, t.clientX, t.clientY);
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    for (var i = 0; i < e.targetTouches.length; i++) {
      var t = e.targetTouches[i];
      var pt = pointers.find(function (x) { return x.id === t.identifier; });
      if (pt) updatePointer(pt, t.clientX, t.clientY);
    }
  }
  function onTouchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = pointers.find(function (x) { return x.id === e.changedTouches[i].identifier; });
      if (t) t.down = false;
    }
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);

  // 返回销毁 + 参数控制接口
  return {
    destroy: function () {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    },
    params: params
  };
}

  /* ---------- 设置面板（右下角悬浮按钮） ---------- */
  function buildPanel(ctrl) {
    // 容器
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9990;font-family:system-ui,-apple-system,sans-serif;';

    // 按钮
    var btn = document.createElement('button');
    btn.textContent = '◐';
    btn.title = '流体设置';
    btn.style.cssText = 'width:42px;height:42px;border-radius:50%;border:1px solid rgba(120,130,150,.35);background:rgba(20,22,30,.6);backdrop-filter:blur(8px);color:rgba(230,235,245,.9);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 18px rgba(0,0,0,.35);transition:all .2s;';
    btn.onmouseenter = function () { btn.style.transform = 'scale(1.06)'; btn.style.background = 'rgba(40,44,58,.75)'; };
    btn.onmouseleave = function () { btn.style.transform = 'scale(1)'; btn.style.background = 'rgba(20,22,30,.6)'; };

    // 面板
    var panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:absolute;bottom:52px;right:0;width:250px;background:rgba(22,24,32,.88);backdrop-filter:blur(12px);border:1px solid rgba(120,130,150,.25);border-radius:14px;padding:14px;box-shadow:0 16px 50px rgba(0,0,0,.5);color:#e8ecf5;font-size:12px;';

    function mkSlider(label, get, set, min, max, step, fmt) {
      var row = document.createElement('div');
      row.style.cssText = 'margin-bottom:10px;';
      var head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;color:#aab3c5;';
      var lab = document.createElement('span');
      lab.textContent = label;
      var val = document.createElement('span');
      val.textContent = fmt ? fmt(get()) : String(get());
      head.appendChild(lab);
      head.appendChild(val);
      var input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = get();
      input.style.cssText = 'width:100%;accent-color:#7c49f3;';
      input.oninput = function () {
        var v = parseFloat(input.value);
        set(v);
        val.textContent = fmt ? fmt(v) : String(v);
      };
      row.appendChild(head);
      row.appendChild(input);
      return row;
    }

    var title = document.createElement('p');
    title.textContent = '流体参数';
    title.style.cssText = 'font-weight:600;font-size:13px;margin:0 0 10px;color:#f0f3fa;';
    panel.appendChild(title);

    // 模式切换：黄金时刻 / 全彩
    var modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
    var goldenBtn = document.createElement('button');
    goldenBtn.textContent = '🌅 黄金时刻';
    var colorBtn = document.createElement('button');
    colorBtn.textContent = '🌈 全彩';
    [goldenBtn, colorBtn].forEach(function (b) {
      b.style.cssText = 'flex:1;padding:7px 0;border-radius:8px;border:1px solid rgba(120,130,150,.3);background:transparent;color:#b9c2d4;font-size:12px;cursor:pointer;transition:all .2s;';
    });
    function syncMode() {
      if (ctrl.params.goldenHour) {
        goldenBtn.style.background = 'rgba(124,73,243,.25)';
        goldenBtn.style.borderColor = '#7c49f3';
        goldenBtn.style.color = '#c9b8ff';
        colorBtn.style.background = 'transparent';
        colorBtn.style.borderColor = 'rgba(120,130,150,.3)';
        colorBtn.style.color = '#b9c2d4';
      } else {
        colorBtn.style.background = 'rgba(120,130,150,.18)';
        colorBtn.style.borderColor = 'rgba(160,170,190,.4)';
        colorBtn.style.color = '#e0e6f2';
        goldenBtn.style.background = 'transparent';
        goldenBtn.style.borderColor = 'rgba(120,130,150,.3)';
        goldenBtn.style.color = '#b9c2d4';
      }
    }
    goldenBtn.onclick = function () {
      ctrl.params.goldenHour = true;
      ctrl.params.curl = 20;
      ctrl.params.densityDissipation = 0.8;
      ctrl.params.velocityDissipation = 0.15;
      ctrl.params.colorUpdateSpeed = 7;
      syncMode(); refreshSliders();
    };
    colorBtn.onclick = function () {
      ctrl.params.goldenHour = false;
      ctrl.params.curl = 30;
      ctrl.params.densityDissipation = 1;
      ctrl.params.velocityDissipation = 0.2;
      ctrl.params.colorUpdateSpeed = 10;
      syncMode(); refreshSliders();
    };
    syncMode();
    modeRow.appendChild(goldenBtn);
    modeRow.appendChild(colorBtn);
    panel.appendChild(modeRow);

    var sliders = [];
    sliders.push(mkSlider('漩涡强度', function () { return ctrl.params.curl; },
      function (v) { ctrl.params.curl = v; }, 0, 50, 1));
    sliders.push(mkSlider('颜色持久度', function () { return Math.round((4 - ctrl.params.densityDissipation) / 4 * 100); },
      function (v) { ctrl.params.densityDissipation = 4 * (1 - v / 100); }, 0, 100, 1, function (v) { return v + '%'; }));
    sliders.push(mkSlider('流动余韵', function () { return Math.round((4 - ctrl.params.velocityDissipation) / 4 * 100); },
      function (v) { ctrl.params.velocityDissipation = 4 * (1 - v / 100); }, 0, 100, 1, function (v) { return v + '%'; }));
    sliders.push(mkSlider('笔刷大小', function () { return Math.round(ctrl.params.splatRadius * 100); },
      function (v) { ctrl.params.splatRadius = v / 100; }, 5, 100, 1, function (v) { return v + '%'; }));
    sliders.push(mkSlider('色彩变化速度', function () { return ctrl.params.colorUpdateSpeed; },
      function (v) { ctrl.params.colorUpdateSpeed = v; }, 1, 30, 1));
    sliders.forEach(function (s) { panel.appendChild(s); });
    function refreshSliders() {
      // 简单刷新所有滑杆值
      panel.querySelectorAll('input[type=range]').forEach(function (inp, idx) {
        var defs = [
          ctrl.params.curl,
          Math.round((4 - ctrl.params.densityDissipation) / 4 * 100),
          Math.round((4 - ctrl.params.velocityDissipation) / 4 * 100),
          Math.round(ctrl.params.splatRadius * 100),
          ctrl.params.colorUpdateSpeed
        ];
        inp.value = defs[idx];
        var val = inp.parentElement.querySelector('span:last-child');
        if (val) val.textContent = idx >= 1 && idx <= 3 ? defs[idx] + '%' : String(defs[idx]);
      });
    }

    var tip = document.createElement('p');
    tip.textContent = '鼠标滑动激起流体光影 · 截图即得壁纸';
    tip.style.cssText = 'color:#7c8798;font-size:10px;margin:8px 0 0;text-align:center;';
    panel.appendChild(tip);

    btn.onclick = function () {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }

  /* ---------- CSS 动画 fallback 层（任何浏览器都保证会动） ---------- */
  function injectFallbackStyle() {
    if (document.getElementById('fluidFallbackStyle')) return;
    var style = document.createElement('style');
    style.id = 'fluidFallbackStyle';
    style.textContent = `
.fluid-fallback{
  position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(circle at 18% 28%, rgba(138,92,245,.55) 0%, transparent 42%),
    radial-gradient(circle at 78% 18%, rgba(56,218,250,.45) 0%, transparent 42%),
    radial-gradient(circle at 62% 76%, rgba(202,108,249,.5) 0%, transparent 42%),
    radial-gradient(circle at 28% 82%, rgba(41,148,255,.42) 0%, transparent 42%),
    radial-gradient(circle at 50% 50%, rgba(122,82,255,.38) 0%, transparent 52%);
  filter:blur(46px);
  animation:fluidFallbackDrift 18s ease-in-out infinite alternate;
}
@keyframes fluidFallbackDrift{
  0%{transform:translate(0,0) scale(1)}
  25%{transform:translate(-2.2%,2%) scale(1.07)}
  50%{transform:translate(3%,-2.2%) scale(.96)}
  75%{transform:translate(1.2%,3.2%) scale(1.06)}
  100%{transform:translate(-1.5%,-1.2%) scale(1)}
}`;
    document.head.appendChild(style);
  }

  function autoMount() {
    if (window.__fluidBgReady) return;
    injectFallbackStyle();
    // 1) CSS 动画 fallback —— 底层，任何浏览器都能动
    var fb = document.createElement('div');
    fb.className = 'fluid-fallback';
    fb.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(fb, document.body.firstChild);
    // 2) WebGL2 流体 canvas —— 增强层，叠加在 fallback 之上
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);
    try {
      var ctrl = initFluidBackground(canvas);
      if (ctrl) {
        window.__fluidBgCtrl = ctrl;
        buildPanel(ctrl);
        console.log('[fluid-background] WebGL2 流体已启动');
      } else {
        console.warn('[fluid-background] WebGL2 不可用，使用 CSS 动画 fallback');
        canvas.remove();
      }
    } catch (err) {
      console.warn('[fluid-background] 流体引擎异常:', err);
      canvas.remove();
    }
    window.__fluidBgReady = true;
  }


  window.fluidBackground = {
    init: autoMount,
    initOn: initFluidBackground,
    get ctrl() { return window.__fluidBgCtrl || null; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
