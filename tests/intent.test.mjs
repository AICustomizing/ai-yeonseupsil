// 의도 기반 테스트 — UI(디자인)는 검사하지 않는다.
// "이 사이트가 하려는 일"이 실제로 되는지만 본다.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
function t(name, fn) {
  try { const msg = fn(); results.push({ name, ok: true, msg: msg || '' }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const PAGES = [
  { id: 'main', file: 'index.html' },
  { id: 'sinsedong', file: '신세동/index.html' },
  { id: 'dashboard', file: 'assets/agent-dashboard.html' },
];
const html = {};
for (const p of PAGES) {
  const fp = join(ROOT, p.file);
  html[p.id] = existsSync(fp) ? readFileSync(fp, 'utf8') : null;
}

// ── 1. 페이지가 존재하는가
for (const p of PAGES) {
  t(`[존재] ${p.file}`, () => {
    assert(html[p.id] !== null, `파일 없음: ${p.file}`);
    assert(html[p.id].length > 500, `내용이 비정상적으로 짧음`);
  });
}

// ── 2. HTML 구조 무결성 (태그 균형)
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[구조] ${p.file} 태그 균형`, () => {
    const src = html[p.id];
    for (const tag of ['div', 'section', 'main', 'header', 'footer', 'ul', 'li', 'a', 'button', 'p']) {
      const open = (src.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
      const close = (src.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
      assert(open === close, `<${tag}> 열림 ${open} / 닫힘 ${close} 불일치`);
    }
    return '주요 태그 균형 OK';
  });
}

// ── 3. 내부 앵커 링크가 실제 대상으로 연결되는가 (의도: 네비게이션이 작동)
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[링크] ${p.file} 앵커 대상 존재`, () => {
    const src = html[p.id];
    const anchors = [...src.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
    const broken = [];
    for (const a of new Set(anchors)) {
      if (!new RegExp(`id="${a}"`).test(src) && !new RegExp(`name="${a}"`).test(src)) broken.push('#' + a);
    }
    assert(broken.length === 0, `대상 없는 앵커: ${broken.join(', ')}`);
    return `${new Set(anchors).size}개 앵커 정상`;
  });
}

// ── 4. 죽은 링크 (의도: 클릭하면 반드시 뭔가 일어나야 함)
// data-* 속성이 붙어 있어도, 그걸 처리하는 JS가 없으면 진짜 죽은 링크다.
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[링크] ${p.file} 클릭 동작하는가`, () => {
    const src = html[p.id];
    const js = [...src.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1]).join('\n');
    const dead = [];
    for (const m of src.matchAll(/<a\b[^>]*href="#"[^>]*>([\s\S]*?)<\/a>/g)) {
      const tag = m[0];
      const label = m[1].replace(/<[^>]*>/g, '').trim().slice(0, 20);
      if (/onclick=/.test(tag)) continue;
      // data-* 훅이 있으면 해당 이름이 JS에 실제로 등장하는지 확인
      const hooks = [...tag.matchAll(/\bdata-([a-zA-Z0-9-]+)/g)].map(x => x[1]);
      if (hooks.length && hooks.some(h => js.includes(h))) continue;
      dead.push(hooks.length ? `"${label}"(data-${hooks[0]} 처리 JS 없음)` : `"${label}"`);
    }
    assert(dead.length === 0,
      `클릭해도 아무 일 없는 링크 ${dead.length}개: ${dead.join(', ')}`);
    return '모든 링크 동작';
  });
}

// ── 5. 상대 경로 리소스가 실제 파일로 존재하는가
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[리소스] ${p.file} 상대경로 파일 존재`, () => {
    const src = html[p.id];
    const base = join(ROOT, dirname(p.file));
    const refs = [...src.matchAll(/(?:href|src)="(?!https?:|data:|mailto:|tel:|#|\/\/)([^"]+)"/g)].map(m => m[1]);
    const missing = [];
    for (const r of new Set(refs)) {
      const clean = r.split(/[?#]/)[0];
      if (!clean) continue;
      const target = join(base, clean);
      const ok = existsSync(target) || existsSync(join(target, 'index.html'));
      if (!ok) missing.push(r);
    }
    assert(missing.length === 0, `없는 파일 참조: ${missing.join(', ')}`);
    return `${new Set(refs).size}개 참조 정상`;
  });
}

// ── 6. 배포 URL 정합성 (의도: 공유하면 올바른 주소로 감)
t('[배포] canonical/og:url 이 실제 배포 도메인과 일치', () => {
  const src = html.main;
  const LIVE = 'ai-yeonseupsil.vercel.app';
  const urls = [...src.matchAll(/(?:canonical"\s+href|og:url"\s+content)="([^"]+)"/g)].map(m => m[1]);
  assert(urls.length > 0, 'canonical/og:url 태그 자체가 없음');
  const wrong = urls.filter(u => !u.includes(LIVE));
  assert(wrong.length === 0,
    `실제 배포는 ${LIVE} 인데 메타태그는 다른 주소를 가리킴: ${[...new Set(wrong)].join(', ')}`);
  return `${urls.length}개 URL 정상`;
});

// ── 7. 배포 전 잔여물 (의도: 프로덕션에 TODO/미완성 표시가 남으면 안 됨)
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[배포] ${p.file} 개발자 주석 잔여물 없음`, () => {
    // 임베드 폰트 등 긴 base64 덩어리는 무작위 문자열이라 오탐의 원인 → 제외
    const src = html[p.id]
      .replace(/base64,[A-Za-z0-9+/=\s]+/g, 'base64,<STRIPPED>')
      .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '<BLOB>');
    const hits = [];
    for (const kw of ['TODO', 'FIXME', 'PLACEHOLDER', 'lorem ipsum']) {
      const n = (src.match(new RegExp(kw, 'gi')) || []).length;
      if (n) hits.push(`${kw}\u00d7${n}`);
    }
    assert(hits.length === 0, `배포 잔여물: ${hits.join(', ')}`);
    return '잔여물 없음';
  });
}

// ── 7b. 미확정 콘텐츠 (의도: 방문자가 신청에 필요한 정보를 실제로 얻을 수 있어야 함)
// .tbd 는 이 프로젝트에서 "아직 안 채운 자리"를 표시하는 클래스다.
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[콘텐츠] ${p.file} 미확정(.tbd) 항목 없음`, () => {
    const src = html[p.id];
    const spans = [...src.matchAll(/<span class="tbd"[^>]*>([\s\S]*?)<\/span>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, '').trim());
    assert(spans.length === 0,
      `채워지지 않은 항목 ${spans.length}개 → ${spans.map(x => `"${x.slice(0, 28)}"`).join(', ')}`);
    return '모든 항목 확정됨';
  });
}

// ── 7c. 자리표시 숫자 (의도: 정원/금액이 실제 값이어야 신청이 성립)
t('[콘텐츠] 자리표시 숫자(00명/00,000원) 없음', () => {
  const src = html.main.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '<BLOB>');
  const bad = [...src.matchAll(/\b00(?:,000)?\s*(?:명|원)/g)].map(m => m[0]);
  assert(bad.length === 0, `미입력 수치 ${bad.length}개: ${[...new Set(bad)].join(', ')}`);
  return '수치 확정됨';
});

// ── 7d. og:image 실제 파일 존재 (의도: 카카오/SNS 공유 시 썸네일이 떠야 함)
t('[공유] og:image 파일이 실제로 존재', () => {
  const src = html.main;
  const m = src.match(/og:image"\s+content="([^"]+)"/);
  assert(m, 'og:image 태그 없음');
  const url = m[1];
  const path = url.replace(/^https?:\/\/[^/]+\//, '');
  assert(existsSync(join(ROOT, path)),
    `og:image 가 ${url} 를 가리키지만 실제 파일(${path})이 없음 → 공유 시 썸네일 안 뜸`);
  return '썸네일 존재';
});

// ── 8. 다크모드가 실제로 동작 가능한 형태인가 (의도: 토글하면 테마가 바뀜)
t('[다크모드] 토글 버튼과 스타일/스크립트가 모두 존재', () => {
  const src = html.main;
  assert(/theme-toggle/.test(src), '토글 버튼 클래스가 없음');
  assert(/\[data-theme[=~|]*["']?dark|\.dark\b|prefers-color-scheme:\s*dark/.test(src),
    '다크 테마 CSS 규칙이 없음 — 버튼만 있고 실제 스타일이 없음');
  assert(/addEventListener|onclick/.test(src), '토글을 처리할 JS가 없음');
  return '토글+CSS+JS 모두 존재';
});

// ── 8b. 하위 페이지 다크모드 일관성 (의도: 메인이 다크면 하위도 다크여야 함)
t('[다크모드] 신세동 페이지도 다크모드 대응', () => {
  const src = html.sinsedong;
  assert(/prefers-color-scheme:\s*dark|\[data-theme/.test(src),
    '메인은 다크모드 지원, 신세동은 미지원 → 다크 사용자가 하위 페이지에서 흰 화면에 눈부심');
  return '일관성 OK';
});

// ── 9. 필수 메타/접근성 기본 (의도: 검색·공유·스크린리더에서 정상 인식)
t('[메타] 필수 태그 존재', () => {
  const src = html.main;
  const need = {
    'lang 속성': /<html[^>]+lang="[^"]+"/,
    'charset': /<meta[^>]+charset=/i,
    'viewport': /<meta[^>]+name="viewport"/i,
    'title': /<title>[^<]{2,}<\/title>/,
    'description': /<meta[^>]+name="description"[^>]+content="[^"]{10,}"/i,
    'og:title': /og:title/,
    'og:description': /og:description/,
  };
  const miss = Object.entries(need).filter(([, re]) => !re.test(src)).map(([k]) => k);
  assert(miss.length === 0, `누락: ${miss.join(', ')}`);
  return '필수 메타 완비';
});

// ── 10. 이미지 대체텍스트 (의도: 접근성 — 스크린리더 사용자도 내용 파악)
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[접근성] ${p.file} img alt 속성`, () => {
    const src = html[p.id];
    const imgs = [...src.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
    const noAlt = imgs.filter(i => !/\balt=/.test(i));
    assert(noAlt.length === 0, `alt 없는 img ${noAlt.length}개`);
    return `img ${imgs.length}개 모두 alt 보유`;
  });
}

// ── 11. 아이콘 전용 버튼의 접근가능한 이름 (의도: 버튼 용도를 읽을 수 있어야 함)
t('[접근성] 아이콘 버튼에 접근가능한 이름', () => {
  const src = html.main;
  const btns = [...src.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
  const bad = [];
  for (const [full, inner] of btns) {
    const text = inner.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim();
    const hasName = /aria-label=|aria-labelledby=|title=/.test(full);
    if (!text && !hasName) bad.push(full.slice(0, 80));
  }
  assert(bad.length === 0, `이름 없는 버튼 ${bad.length}개: ${bad.join(' | ')}`);
  return `button ${btns.length}개 정상`;
});

// ── 12. 중복 id (의도: JS/앵커가 엉뚱한 요소를 잡으면 안 됨)
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[구조] ${p.file} 중복 id 없음`, () => {
    const ids = [...html[p.id].matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const seen = new Set(), dup = new Set();
    for (const i of ids) { if (seen.has(i)) dup.add(i); seen.add(i); }
    assert(dup.size === 0, `중복 id: ${[...dup].join(', ')}`);
    return `id ${ids.length}개 고유`;
  });
}

// ── 13. 인라인 JS 문법 유효성 (의도: 스크립트가 죽으면 기능 전체가 죽음)
for (const p of PAGES) {
  if (!html[p.id]) continue;
  t(`[JS] ${p.file} 인라인 스크립트 문법`, () => {
    const tags = [...html[p.id].matchAll(/<script\b((?![^>]*\bsrc=)[^>]*)>([\s\S]*?)<\/script>/g)];
    const blocks = tags
      .filter(m => !/type=["'](application\/ld\+json|text\/template)/.test(m[1]))
      .map(m => m[2])
      .filter(s => s.trim());
    for (const [i, code] of blocks.entries()) {
      try { new Function(code); }
      catch (e) { throw new Error(`스크립트 블록 #${i + 1} 문법오류: ${e.message}`); }
    }
    return `${blocks.length}개 블록 파싱 OK`;
  });
}

// ── 14. JSON-LD 유효성 (의도: 검색엔진이 구조화 데이터를 읽을 수 있어야 함)
for (const p of PAGES) {
  if (!html[p.id]) continue;
  const lds = [...html[p.id].matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!lds.length) continue;
  t(`[SEO] ${p.file} JSON-LD 파싱`, () => {
    lds.forEach((raw, i) => {
      try { JSON.parse(raw); } catch (e) { throw new Error(`JSON-LD #${i + 1} 파싱실패: ${e.message}`); }
    });
    return `${lds.length}개 유효`;
  });
}

// ── 출력
const fail = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? '🟢' : '🔴'} ${r.name}${r.msg ? ` — ${r.msg}` : ''}`);
console.log(`\n${'='.repeat(60)}\n합계: ${results.length}개 | 🟢 ${results.length - fail.length} | 🔴 ${fail.length}`);
process.exit(fail.length ? 1 : 0);
