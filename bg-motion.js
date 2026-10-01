/* 墨詠み：水墨画の背景を「静かに動かす」（WebGL）。
   作業場 墨詠み_作業場/背景の動き/bg_motion.html の試作をそのまま移したもの。
   使えない環境（WebGLなし・読み込み失敗・動きを減らす設定）では何もせず、index.html側の止まった絵のままになる。
   公開する関数: window.BgMotion.start(n)  n=1..4（bg/bg{n}.webp に対応） */
(function(){
"use strict";
// 「動きを減らす」設定の人には動かさない（確認用に ?motion=1 を付けると、この設定を無視して動かせる）
if(/[?&]motion=0/.test(location.search)) return;   // ?motion=0 を付けると、動かさず止まった絵のままにする（重いときの逃げ道）
if(matchMedia("(prefers-reduced-motion: reduce)").matches && !/[?&]motion=1/.test(location.search)) return;

/* 4枚それぞれの「常に静かに動くもの」。座標は絵の実寸941×1672。
   mist＝霞の帯 [x0,y0,x1,y1,強さ]／shade＝雲の影が横切る帯／pine＝松葉が揺れる範囲 */
const SCENES={
  1:{img:"bg/bg1.webp", drift:[[0,200,9,.22,0.],[120,330,18,.3,1.7],[230,470,28,.38,3.1],[1340,1672,24,.32,.8]], mist:[[0,110,941,430,.9],[0,1350,941,1672,.9]]},
  2:{img:"bg/bg2_plate.webp", cut:"bg/bg2", pine:[30,0,860,500], mist:[[380,1400,941,1672,1],[0,1540,941,1672,.6],[0,330,941,560,.5]]},
  3:{img:"bg/bg3_plate.webp", cut:"bg/bg3", wmask:"bg/bg3_mask.webp", water:1, flow:"bg/bg3_flow.webp", mist:[[0,380,941,640,.7],[0,1330,941,1480,.5]]},
  4:{img:"bg/bg4.webp", drift:[[0,170,12,.2,0.],[90,310,22,.28,2.0],[1150,1420,26,.3,1.1],[1380,1672,10,.24,2.6]], mist:[[0,60,941,420,.85],[0,1180,941,1400,.85]], shade:[0,1390,941,1672]},
};

/* 横長の画面用：絵を幅いっぱいに広げたとき、絵の上の部分を画面の上端、下の部分を画面の下端に置き、間の和紙の空白は伸ばして埋める。
   cut=[上の部分の下端, 下の部分の上端]（絵の実寸の縦位置）。中の空白に動くものがないことを前提にしている */
const CUTS={1:[470,1330],2:[600,1370],3:[660,1220],4:[470,1170]};

const VS="attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}";
const FS=`precision mediump float;
varying vec2 v; uniform sampler2D img, gmask, flowt, grasst, bendt; uniform float hasCut;
uniform vec2 isz, ssz, off; uniform float sc, t, hasWater; uniform vec2 cutY; uniform float wide;
uniform vec4 drift[4]; uniform vec2 driftP[4]; uniform vec4 pine; uniform vec4 mist[3]; uniform float mistA[3]; uniform vec4 shade; uniform float hasShade;
float box(vec2 p,vec4 r,float f){return smoothstep(r.x-f,r.x+f,p.x)*(1.-smoothstep(r.z-f,r.z+f,p.x))*smoothstep(r.y-f,r.y+f,p.y)*(1.-smoothstep(r.w-f,r.w+f,p.y));}
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*n2(p);p*=2.03;a*=.5;}return s;}
void main(){
  vec2 sp=vec2(v.x,1.-v.y)*ssz, p=(sp-off)/sc, d=vec2(0.);
  if(wide>.5){
    // 横長：画面の幅に合わせた拡大率 sc。上の部分は上端から、下の部分は下端から並べ、間は絵の空白の1行を引き伸ばす
    float topH=cutY.x*sc, botH=(isz.y-cutY.y)*sc;
    float x=(sp.x-off.x)/sc;
    if(sp.y<topH)               p=vec2(x, sp.y/sc);
    else if(sp.y>ssz.y-botH)    p=vec2(x, cutY.y+(sp.y-(ssz.y-botH))/sc);
    else                        p=vec2(x, mix(cutY.x-60.,cutY.y+60.,(sp.y-topH)/(ssz.y-topH-botH)));
  }
  if(pine.z>0.){
    float pn=box(p,pine,30.)*(1.-smoothstep(pine.z-120.,pine.z+20.,p.x));
    float pg=n2(vec2(t*.3+p.x*.001,7.7));
    d+=pn*vec2((pg-.45)*3.2,abs(pg-.45)*1.2);
  }
  // 帯ごとにゆっくり横へ往復する（雲海や霞の層が奥と手前で違う速さでたゆたう）。上下の端はなだらかに消える
  for(int i=0;i<4;i++){
    if(drift[i].w>0.){
      float yy=smoothstep(drift[i].x,drift[i].x+(drift[i].y-drift[i].x)*.35,p.y)*(1.-smoothstep(drift[i].y-(drift[i].y-drift[i].x)*.35,drift[i].y,p.y));
      d.x+=yy*drift[i].z*sin(t*drift[i].w+driftP[i].x);
    }
  }
  vec3 col=texture2D(img,(p-d)/isz).rgb;
  if(hasWater>.5){
    vec3 wm=texture2D(gmask,p/isz).rgb;
    float wf=wm.r;
    vec3 fl=texture2D(flowt,p/isz).rgb;
    vec2 rdir=normalize(fl.rg*2.-1.+vec2(1e-4)); float wr=fl.b;
    if(wf>.001){
      float f0=fract(t/1.6), f1=fract(t/1.6+.5);
      vec3 A=texture2D(img,(p-vec2(0.,30.*wf)*f0)/isz).rgb, B=texture2D(img,(p-vec2(0.,30.*wf)*f1)/isz).rgb;
      col=mix(col,mix(A,B,abs(1.-2.*f0)),clamp(wf*1.2,0.,1.));
    }
    if(wr>.001){
      float persp=mix(.45,1.35,clamp((p.y-1400.)/272.,0.,1.));
      float per=2.6, L=26.*wr*persp;
      float f0=fract(t/per), f1=fract(t/per+.5);
      vec3 A=texture2D(img,(p-rdir*L*f0)/isz).rgb, B=texture2D(img,(p-rdir*L*f1)/isz).rgb;
      col=mix(col,mix(A,B,abs(1.-2.*f0)),clamp(wr*1.15,0.,1.));
      vec2 perp=vec2(-rdir.y,rdir.x);
      float u=dot(p,rdir)/persp, vv=dot(p,perp)/persp;
      float ns=fbm(vec2(u*.05-t*1.0, vv*.018));
      float ns2=fbm(vec2(u*.11-t*1.9+7.3, vv*.04));
      float hi=smoothstep(.57,.8,ns)*.7+smoothstep(.62,.84,ns2)*.4;
      float lo=smoothstep(.36,.16,ns);
      col=mix(col,vec3(.985,.975,.955),clamp(hi*wr*.5,0.,.6));
      col*=1.-lo*wr*.13;
    }
    if(wf>.001){
      float fall=fbm(vec2(p.x*.09, p.y*.012 - t*1.9));
      float hi=smoothstep(.5,.78,fall), lo=smoothstep(.45,.2,fall);
      col=mix(col,vec3(.975,.965,.94),hi*wf*.55);
      col*=1.-lo*wf*.16;
    }
  }
  if(hasCut>.5){
    float gust=n2(vec2(t*.45+p.x*.0018,3.1));
    float lean=(gust*1.25-.3)+sin(t*2.1+p.x*.01)*.12;
    float bw=texture2D(bendt,p/isz).r;
    vec2 gd=vec2(bw*lean*18., bw*abs(lean)*3.);
    vec4 gr=texture2D(grasst,(p-gd)/isz);
    col=mix(col,gr.rgb,gr.a);
  }
  vec2 q=p/vec2(941.,1672.);
  float m=0.;
  for(int i=0;i<3;i++){ m+=box(p,mist[i],70.)*mistA[i]; }
  if(m>.001){
    // 雲海：形のある大きなかたまりが、奥（ゆっくり・小さく）と手前（速く・大きく）の2枚で横へ流れる
    float back =fbm(vec2(q.x*2.4-t*.018, q.y*7.5+1.3));
    float front=fbm(vec2(q.x*1.3-t*.026, q.y*4.2+5.1));
    float cb=smoothstep(.47,.7,back)*.5, cf=smoothstep(.5,.7,front)*.85;
    float cloud=1.-(1.-cb)*(1.-cf);
    col=mix(col,vec3(.945,.915,.86),clamp(m*cloud,0.,.88));
  }
  if(hasShade>.5){
    float s=box(p,shade,60.)*smoothstep(.45,.68,fbm(vec2(q.x*1.2-t*.018, q.y*2.6)));
    col*=1.-s*.4;
  }
  if(wide>.5){
    // 絵の左右の外は和紙の色。絵の端の幅の約12%をかけて、なだらかにつなぐ（細い帯に見えないように）
    float xi=(sp.x-off.x)/sc/isz.x;              // 0..1 が絵の幅
    float edge=smoothstep(0.,.14,xi)*(1.-smoothstep(.86,1.,xi));
    col=mix(vec3(.933,.89,.824),col,clamp(edge,0.,1.));
  }
  gl_FragColor=vec4(col,1.);
}`;

let cv=null, gl=null, pr=null, U=null, IMG=null, raf=0, started=false, t0=0, SCENE=1;
const load=src=>new Promise((ok,ng)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=ng;i.src=src;});

function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));return s;}

function init(){
  cv=document.createElement("canvas"); cv.id="bgmotion"; cv.setAttribute("aria-hidden","true");
  gl=cv.getContext("webgl",{antialias:false,alpha:false});
  if(!gl) throw new Error("no webgl");
  pr=gl.createProgram(); gl.attachShader(pr,sh(gl.VERTEX_SHADER,VS)); gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FS));
  gl.linkProgram(pr); if(!gl.getProgramParameter(pr,gl.LINK_STATUS)) throw new Error("link");
  gl.useProgram(pr);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const la=gl.getAttribLocation(pr,"a"); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la,2,gl.FLOAT,false,0,0);
  U=n=>gl.getUniformLocation(pr,n);
  // #bgimg（止まった絵）の直後に置く。絵が動き始めたら止まった絵は隠れる
  const ref=document.getElementById("bgimg"); ref.parentNode.insertBefore(cv,ref.nextSibling);
  addEventListener("resize",resize); resize();
  document.addEventListener("visibilitychange",()=>{ if(document.hidden){cancelAnimationFrame(raf);raf=0;} else if(IMG&&!raf) raf=requestAnimationFrame(frame); });
}
function resize(){
  const dpr=Math.min(devicePixelRatio||1,1.5);
  cv.width=Math.round(innerWidth*dpr); cv.height=Math.round(innerHeight*dpr);
  gl.viewport(0,0,cv.width,cv.height);
}
function mkTex(unit,src,fmt){
  const tx=gl.createTexture(); gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,tx);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(src) gl.texImage2D(gl.TEXTURE_2D,0,fmt,fmt,gl.UNSIGNED_BYTE,src);
  else gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,1,1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,new Uint8Array([0]));
}
async function setScene(n){
  const S=SCENES[n]; if(!S) return;
  const [im,gm,fw,gt,bt]=await Promise.all([
    load(S.img), S.wmask?load(S.wmask):null, S.flow?load(S.flow):null,
    S.cut?load(S.cut+"_grass.webp"):null, S.cut?load(S.cut+"_bend.webp"):null]);
  mkTex(0,im,gl.RGB); mkTex(1,gm,gl.RGB); mkTex(2,fw,gl.RGB); mkTex(3,gt,gl.RGBA); mkTex(4,bt,gl.LUMINANCE);
  gl.uniform1i(U("img"),0); gl.uniform1i(U("gmask"),1); gl.uniform1i(U("flowt"),2); gl.uniform1i(U("grasst"),3); gl.uniform1i(U("bendt"),4);
  gl.uniform1f(U("hasCut"),S.cut?1:0); gl.uniform1f(U("hasWater"),S.water?1:0);
  const dr=(S.drift||[]).concat([[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]).slice(0,4);
  gl.uniform4fv(U("drift"),dr.flatMap(x=>[x[0],x[1],x[2],x[3]])); gl.uniform2fv(U("driftP"),dr.flatMap(x=>[x[4],0]));
  gl.uniform4fv(U("pine"),S.pine?[S.pine[0],S.pine[1],S.pine[2],S.pine[3]]:[0,0,0,0]);
  const ms=(S.mist||[]).concat([[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]).slice(0,3);
  gl.uniform4fv(U("mist"),ms.flatMap(m=>m.slice(0,4))); gl.uniform1fv(U("mistA"),ms.map(m=>m[4]));
  gl.uniform4fv(U("shade"),S.shade||[0,0,0,0]); gl.uniform1f(U("hasShade"),S.shade?1:0);
  IMG=im; SCENE=n;
}
function frame(now){
  raf=requestAnimationFrame(frame);
  const W=cv.width,H=cv.height;
  // 画面が絵より横に広い（絵の縦横比 941:1672 より横長）なら、上下に分けて配置する
  const wide=(W/H)>(IMG.width/IMG.height)*1.15, cut=CUTS[SCENE]||[470,1200];
  let sc;
  if(wide){
    // 高さ基準：上の部分と下の部分の高さの合計が、画面の高さの約58%に収まる拡大率。ただし幅いっぱい（W/IMG.width）は超えない
    const need=(cut[0]+(IMG.height-cut[1]));
    sc=Math.min(W/IMG.width, 0.58*H/need);
    sc=Math.max(sc, 0.35*H/need);
  } else sc=Math.max(W/IMG.width,H/IMG.height);
  gl.uniform2f(U("isz"),IMG.width,IMG.height); gl.uniform2f(U("ssz"),W,H);
  gl.uniform2f(U("off"),(W-IMG.width*sc)/2,wide?0:(H-IMG.height*sc)/2); gl.uniform1f(U("sc"),sc);
  gl.uniform1f(U("wide"),wide?1:0); gl.uniform2f(U("cutY"),cut[0],cut[1]);
  gl.uniform1f(U("t"),(now-t0)/1000);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  if(!started){ started=true; document.body.classList.add("has-motion"); }   // 初めて描けたら、止まった絵を隠す
}

window.BgMotion={
  async start(n){
    try{
      init();
      await setScene(n);
      t0=performance.now();
      raf=requestAnimationFrame(frame);
    }catch(e){
      // 何か失敗したら、止まった絵のままにする（キャンバスは取り除く）
      if(cv&&cv.parentNode) cv.parentNode.removeChild(cv);
      document.body.classList.remove("has-motion");
      if(window.console) console.warn("BgMotion off:",e&&e.message);
    }
  }
};
})();
