// =====================================================================
//  FongMi JS 脚本源 · v4
//  ① 目录：豆瓣（高分电影 / Top250）
//     - 海报用「@Referer=…」后缀破解豆瓣防盗链
//  ② 两类玩法：
//     · 普通分类（⭐/🏆）：点开看豆瓣简介 + 内置采集站线路（详情页 3 条线）
//     · 「直搜」分类（⚡）：vod_id 用 "msearch:片名" 前缀 —— 播放器识别后会【跳过详情、
//       立刻拿片名去搜遍配置里所有可搜索站点】，并自动选中第一个源（= 免费分享那种体验）
//  依据 FongMi 源码 VodPlaybackController：SEARCH_PREFIX = "msearch:"
//    checkId() → id.startsWith("msearch:") → detailEmpty(false)
//    → fallbackPolicy.emptyDetail() → search(getVodName(), autoFallback=true)
//  格式：ES 模块 + export default（播放器 js/lib/spider.js 读取 spider.default）
// =====================================================================

const UA = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const H_MOVIE = { 'User-Agent': UA, 'Referer': 'https://movie.douban.com/' };
const H_M = { 'User-Agent': UA, 'Referer': 'https://m.douban.com/' };
const H_C = { 'User-Agent': UA };

// 图片请求头后缀（播放器 ImgUtil.getUrl 解析）
const IMG_SUFFIX = '@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0';

// 豆瓣「电影」标签会把演唱会/舞台剧/特辑混进来，这里过滤掉
const EXCLUDE = /(演唱[会會]|音乐[会會]|音乐剧|音乐节|交响|巡回|巡演|演奏[会會]|独奏[会會]|舞台剧|话剧|舞剧|栋笃笑|纪念演出|脱口秀|现场版|花絮|幕后|特辑|特别集|特别篇|LIVE|现场|大师课)/i;

// ---- 内置采集站（界面上不出现，只用于「点开即出片源」）----
const COLLECT = [
  { name: '天堂', api: 'http://caiji.dyttzyapi.com/api.php/provide/vod' },
  { name: '量子', api: 'https://cj.lziapi.com/api.php/provide/vod' },
  { name: '极速', api: 'https://jszyapi.com/api.php/provide/vod' }
];

const sleep = (ms) => { try { const t = Date.now(); while (Date.now() - t < ms) { } } catch (e) { } };

function httpSync(url, headers) {
  const opt = { async: false, method: 'GET', headers: headers || {} };
  if (typeof req === 'function') return req(url, opt);
  if (globalThis && typeof globalThis.req === 'function') return globalThis.req(url, opt);
  throw new Error('no-http-func');
}

function body(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  const keys = ['content', 'body', 'text', 'data', 'json'];
  for (let i = 0; i < keys.length; i++) {
    const v = res[keys[i]];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return JSON.stringify(v);
  }
  try { return JSON.stringify(res); } catch (e) { return ''; }
}

function getJSON(url, headers) {
  const t = body(httpSync(url, headers));
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

// 图片地址：统一 https + 追加请求头后缀
function pickPic(u) {
  let s = String(u || '').trim();
  if (s.indexOf('//') === 0) s = 'https:' + s;
  s = s.replace(/^http:\/\//i, 'https://');
  if (!s || s.indexOf('://') < 0) return '';
  return s + IMG_SUFFIX;
}

function scoreText(r) {
  const v = r && (r.value !== undefined ? r.value : r);
  return v ? ('豆瓣 ' + v) : '';
}

// ---- 分类1：高分电影 ----
function listHighScore(page, useSearch) {
  const start = (page - 1) * 20;
  const url = 'https://movie.douban.com/j/new_search_subjects?sort=S&range=0,10&tags=' +
    encodeURIComponent('电影') + '&start=' + start;
  const j = getJSON(url, H_MOVIE);
  const arr = (j && j.data) || [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    const name = String(it.title || '');
    if (!name || EXCLUDE.test(name)) continue;
    out.push({
      vod_id: useSearch ? ('msearch:' + it.id) : ('db:' + it.id),
      vod_name: name,
      vod_pic: pickPic(it.cover),
      vod_remarks: it.rate ? ('豆瓣 ' + it.rate) : ''
    });
  }
  return out;
}

// ---- 分类2：豆瓣 Top250 ----
function listTop250(page, useSearch) {
  const start = (page - 1) * 20;
  const url = 'https://m.douban.com/rexxar/api/v2/subject_collection/movie_top250/items?start=' +
    start + '&count=20';
  const j = getJSON(url, H_M);
  const arr = (j && j.subject_collection_items) || [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    const name = String(it.title || '');
    if (!name) continue;
    const rk = it.rank || (start + i + 1);
    out.push({
      vod_id: useSearch ? ('msearch:' + (it.id || '')) : ('db:' + (it.id || '')),
      vod_name: name,
      vod_pic: pickPic(it.cover_url || it.pic),
      vod_remarks: 'No.' + rk + (it.rating && it.rating.value ? (' · 豆瓣 ' + it.rating.value) : '')
    });
  }
  return out;
}

// ---- 去采集站按片名搜索 → [{idx, site, vodId, name}] ----
function searchCollect(name) {
  const out = [];
  for (let i = 0; i < COLLECT.length; i++) {
    try {
      const j = getJSON(COLLECT[i].api + '/?wd=' + encodeURIComponent(name), H_C);
      const lst = (j && j.list) || [];
      if (lst.length) {
        out.push({
          idx: i,
          site: COLLECT[i].name,
          vodId: String(lst[0].vod_id || ''),
          name: String(lst[0].vod_name || name)
        });
      }
    } catch (e) { }
  }
  return out;
}

// ---- 取某站某片的真实播放地址（从返回里挑 .m3u8 优先）----
function resolvePlay(idx, vodId) {
  try {
    const c = COLLECT[idx];
    if (!c) return '';
    const j = getJSON(c.api + '/?ac=detail&ids=' + vodId, H_C);
    const lst = (j && j.list) || [];
    if (!lst.length) return '';
    const raw = String(lst[0].vod_play_url || '');
    const urls = raw.match(/https?:\/\/[^\s#$]+/g) || [];
    let best = '';
    for (let i = 0; i < urls.length; i++) {
      if (urls[i].indexOf('.m3u8') >= 0) { best = urls[i]; break; }
    }
    if (!best && urls.length) best = urls[0];
    return best;
  } catch (e) { return ''; }
}

// ---- 详情（豆瓣数据 + 采集站片源）----
function detailOf(id) {
  const sid = String(id || '').replace(/^db:/, '');
  const j = getJSON('https://m.douban.com/rexxar/api/v2/movie/' + sid, H_M);
  if (!j) return null;
  const join = (a, key) => (a || []).map(x => (x && x[key]) ? x[key] : '').filter(Boolean).join('、');
  const name = String(j.title || '');

  // ★ 拿片名去采集站搜，直接生成可播线路
  let pFrom = '', pUrl = '';
  try {
    const hits = searchCollect(name);
    if (hits.length) {
      pFrom = hits.map(h => h.site).join('$$$');
      pUrl = hits.map(h => h.name + '$' + h.idx + '|' + h.vodId).join('$$$');
    }
  } catch (e) { }

  return {
    vod_id: 'db:' + sid,
    vod_name: name,
    vod_pic: pickPic((j.pic && (j.pic.large || j.pic.normal)) || j.cover_url),
    vod_year: String(j.year || ''),
    vod_area: (j.countries || []).join('、'),
    vod_actor: join(j.actors, 'name'),
    vod_director: join(j.directors, 'name'),
    vod_remarks: scoreText(j.rating),
    type_name: (j.genres || []).join('、'),
    vod_content: String(j.intro || '').replace(/<[^>]+>/g, '').trim(),
    vod_play_from: pFrom,
    vod_play_url: pUrl
  };
}


// =====================================================================
//  ★ 自建合集（三块内容，玩法统一：点海报 → 直接全网直搜）
//   ① MARVEL   上映顺序（百度百科 + 补全）含神盾局 S1–S7，30 条
//   ② TIMELINE 剧情时间线（mcuatlas co 序号），38 部电影
//   ③ DOC      小学纪录片 7 学科 × 年级，共 60 部（无封面者用占位图）
//  依据 FongMi 源码：vod_id 以 msearch: 开头 → 直接 search(vod_name) 全网搜源
//  ⚠️ 铁律：vod_name 必须是「目标站点实际使用的片名」，序号只能放 vod_remarks
// =====================================================================
const MARVEL = [
  { n: "钢铁侠", y: "2008", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250325-1/3e7847fe94093e31e54447ec8e7fbb3d.jpg" },
  { n: "无敌浩克", y: "2008", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250211-1/8e0fe2c47fd754bdc2f79142475c0505.jpg" },
  { n: "钢铁侠2", y: "2010", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250325-1/c539926063a1564fe70a792c1ad51c3d.jpg" },
  { n: "雷神", y: "2011", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250606-1/0acaf32ec7753629c4823d7171fbdb49.jpg" },
  { n: "美国队长", y: "2011", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251106-1/26e74c507317ae65fb11fcd0a9bf078a.jpg" },
  { n: "复仇者联盟", y: "2012", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/aef1864a9e5ed6457ad1ae44962d2b0c.jpg" },
  { n: "钢铁侠3", y: "2013", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250325-1/93b066cbbf629af52ae95364e813cd51.jpg" },
  { n: "神盾局特工第一季", y: "2013", k: "剧集", p: "https://img.dytt-tupian.com/upload/vod/20250311-1/4eb03bf082c38d8fd5ec08b53ff38e5e.jpg" },
  { n: "雷神2：黑暗世界", y: "2013", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250603-1/fc12985682de1866b9770561dfc6a577.jpg" },
  { n: "美国队长2", y: "2014", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251106-1/8c4b4d0279bfc920b2e13a6fc0148142.jpg" },
  { n: "银河护卫队", y: "2014", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250629-1/c126c949d596ddd2c5529ea7b874821e.jpg" },
  { n: "神盾局特工第二季", y: "2014", k: "剧集", p: "https://img.dytt-tupian.com/upload/vod/20250311-1/a51fbb49362b9d0f90e597e96a211963.jpg" },
  { n: "复仇者联盟2：奥创纪元", y: "2015", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/ee014839774f8590cd744fff4cb754f4.jpg" },
  { n: "蚁人", y: "2015", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250601-1/c9cf1c771d78f3e454ccbed069244be5.jpg" },
  { n: "神盾局特工第三季", y: "2015", k: "剧集", p: "https://img.dytt-tupian.com/upload/vod/20250311-1/a367c18a01d1b94fccb85fe76465097d.jpg" },
  { n: "美国队长3", y: "2016", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251106-1/baed1043de4108b167daddd5933d55a9.jpg" },
  { n: "神盾局特工第四季", y: "2016", k: "剧集", p: "https://img.dytt-tupian.com/upload/vod/20250311-1/5cf77955b8fa4759cd9720616328cbab.jpg" },
  { n: "奇异博士", y: "2016", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250401-1/8e107502169fae1378063424b69e59d9.jpg" },
  { n: "银河护卫队2", y: "2017", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250629-1/fc124e3c9d96f8ef7e3834c273e71fa2.jpg" },
  { n: "蜘蛛侠：英雄归来", y: "2017", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250531-1/c78815a5e24ec30d8cde7ccb3808fca5.jpg" },
  { n: "雷神3：诸神黄昏", y: "2017", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250606-1/1a40ffb5de67f93d5f7367450b612590.jpg" },
  { n: "神盾局特工第五季", y: "2017", k: "剧集", p: "https://img.dytt-tupian.com/upload/vod/20250311-1/68f8ccc9212dbcebeb5c0122510ef5fa.jpg" },
  { n: "黑豹", y: "2018", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250602-1/0b5098a42acd1c2b29177ba011b85023.jpg" },
  { n: "复仇者联盟3：无限战争", y: "2018", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/f6f3c04011f6a78a73a37f4d3ea24f66.jpg" },
  { n: "蚁人2：黄蜂女现身", y: "2018", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250601-1/ebca9dfb2d4991b445482b727c041b5b.jpg" },
  { n: "惊奇队长", y: "2019", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251223-1/a3ac22d81a36c6b4b137608c564070ea.jpg" },
  { n: "复仇者联盟4：终局之战", y: "2019", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/18288861e9bb9815120a0183703174ea.jpg" },
  { n: "神盾局特工第六季", y: "2019", k: "剧集", p: "https://img.dytt-tupian.com/upload/vod/20250311-1/5531da8a4297c559144232b0b6dba887.jpg" },
  { n: "蜘蛛侠：英雄远征", y: "2019", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250531-1/3d5c33f52dbb803f025ea187b9d52492.jpg" },
  { n: "神盾局特工第七季", y: "2020", k: "剧集", p: "https://img.dytt-tupian.com/upload/vod/20250311-1/0012914a90c46adbe4ed918ba3144d49.jpg" },
];

const TIMELINE = [
  { n: "美国队长", y: "2011", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251106-1/26e74c507317ae65fb11fcd0a9bf078a.jpg" },
  { n: "惊奇队长", y: "2019", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251223-1/a3ac22d81a36c6b4b137608c564070ea.jpg" },
  { n: "钢铁侠", y: "2008", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250325-1/3e7847fe94093e31e54447ec8e7fbb3d.jpg" },
  { n: "无敌浩克", y: "2008", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250211-1/8e0fe2c47fd754bdc2f79142475c0505.jpg" },
  { n: "钢铁侠2", y: "2010", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250325-1/c539926063a1564fe70a792c1ad51c3d.jpg" },
  { n: "雷神", y: "2011", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250606-1/0acaf32ec7753629c4823d7171fbdb49.jpg" },
  { n: "复仇者联盟", y: "2012", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/aef1864a9e5ed6457ad1ae44962d2b0c.jpg" },
  { n: "钢铁侠3", y: "2013", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250325-1/93b066cbbf629af52ae95364e813cd51.jpg" },
  { n: "雷神2：黑暗世界", y: "2013", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250603-1/fc12985682de1866b9770561dfc6a577.jpg" },
  { n: "美国队长2", y: "2014", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251106-1/8c4b4d0279bfc920b2e13a6fc0148142.jpg" },
  { n: "银河护卫队", y: "2014", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250629-1/c126c949d596ddd2c5529ea7b874821e.jpg" },
  { n: "银河护卫队2", y: "2017", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250629-1/fc124e3c9d96f8ef7e3834c273e71fa2.jpg" },
  { n: "复仇者联盟2：奥创纪元", y: "2015", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/ee014839774f8590cd744fff4cb754f4.jpg" },
  { n: "蚁人", y: "2015", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250601-1/c9cf1c771d78f3e454ccbed069244be5.jpg" },
  { n: "美国队长3", y: "2016", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251106-1/baed1043de4108b167daddd5933d55a9.jpg" },
  { n: "黑寡妇", y: "2021", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251020-1/1268ffed8d57fd06f6d701fe724091c9.jpg" },
  { n: "黑豹", y: "2018", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250602-1/0b5098a42acd1c2b29177ba011b85023.jpg" },
  { n: "蜘蛛侠：英雄归来", y: "2017", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250531-1/c78815a5e24ec30d8cde7ccb3808fca5.jpg" },
  { n: "奇异博士", y: "2016", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250401-1/8e107502169fae1378063424b69e59d9.jpg" },
  { n: "雷神3：诸神黄昏", y: "2017", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250606-1/1a40ffb5de67f93d5f7367450b612590.jpg" },
  { n: "蚁人2：黄蜂女现身", y: "2018", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250601-1/ebca9dfb2d4991b445482b727c041b5b.jpg" },
  { n: "复仇者联盟3：无限战争", y: "2018", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/f6f3c04011f6a78a73a37f4d3ea24f66.jpg" },
  { n: "复仇者联盟4：终局之战", y: "2019", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250617-1/18288861e9bb9815120a0183703174ea.jpg" },
  { n: "永恒族", y: "2021", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250601-1/120f9d911da8612cf9a7e35ff6f77c73.jpg" },
  { n: "尚气与十环传奇", y: "2021", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251020-1/2f661a01f1a58bc20aa9c3b80f6c007d.jpg" },
  { n: "蜘蛛侠：英雄远征", y: "2019", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250531-1/3d5c33f52dbb803f025ea187b9d52492.jpg" },
  { n: "蜘蛛侠：英雄无归", y: "2021", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250531-1/6a1d58cb7b1ca10e34a285be3312ba13.jpg" },
  { n: "死侍与金刚狼", y: "2024", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250531-1/a343fa405a28ebde571707ad795ae091.jpg" },
  { n: "奇异博士2：疯狂多元宇宙", y: "2022", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20251107-1/b1ce142d15168bc53e1c7e7be322194d.jpg" },
  { n: "雷神4：爱与雷霆", y: "2022", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250603-1/a4c18d84db560983456367921ab13124.jpg" },
  { n: "黑豹2", y: "2022", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250601-1/c680626180dc5bd229eb48332d6a3f32.jpg" },
  { n: "蚁人与黄蜂女：量子狂潮", y: "2023", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250531-1/78d8bf0636bc9c7b5d76e545b2b414ba.jpg" },
  { n: "银河护卫队3", y: "2023", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250629-1/e25e95864f4f4003a90c09d370b675ce.jpg" },
  { n: "惊奇队长2", y: "2023", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250524-1/905ef79c6914c07aed6c3712bfd74055.jpg" },
  { n: "美国队长4", y: "2025", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250307-1/855219db569382b2cae213d25ad33b30.jpg" },
  { n: "雷霆特攻队", y: "2025", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250701-1/e6b542a96e1a2e01788672511de06240.jpg" },
  { n: "神奇四侠2", y: "2025", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20250318-1/774364838e6a871458743431f029d2c3.jpg" },
  { n: "蜘蛛侠：崭新之日", y: "2026", k: "电影", p: "https://img.dytt-tupian.com/upload/vod/20260730-1/1fdeeb21521911e4ef46d2340a109897.jpg" },
];

const DOC = {
  "doc_yuwen": [
  { n: "美丽中国", y: "", k: "一年级", p: "https://img.lzipic.com/upload/vod/20231008-1/07c58cd6a0fb1818a8eeae62e5b6cfc4.jpg" },
  { n: "汉字五千年", y: "", k: "二年级", p: "https://img.lzipic.com/upload/vod/20240620-1/5e7345c24eacbbaa13cc58f1c6dc0268.jpg" },
  { n: "跟着书本去旅行", y: "", k: "三年级", p: "https://img.dytt-tupian.com/upload/vod/20250224-1/e0323494229b1eeee2cd041724789e61.jpg" },
  { n: "千古风流人物 第二季", y: "", k: "四年级", p: "https://img.lzipic.com/upload/vod/20220608-1/9bb7d194a0bb27c8ed3edb9d374ce0e3.jpg" },
  { n: "中国诗词大会第六季", y: "", k: "五六年级", p: "https://img.dytt-tupian.com/upload/vod/20250515-1/92d3eb9a77baec247aa305430a3f0074.jpg" },
  { n: "中国通史", y: "", k: "2013", p: "https://img.lzipic.com/upload/vod/20241021-1/bae5214213027a34ef2efe4e00352207.jpg" },
  { n: "宗师列传·唐宋八大家", y: "", k: "2023", p: "https://img.lzipic.com/upload/vod/20231112-1/2443bf6d8623b01678dab6c6513d6f7a.jpg" },
  { n: "定风波", y: "", k: "2025", p: "https://img.dytt-tupian.com/upload/vod/20250707-1/9b44c5c0b458210c9420fcf3ffdb1eb3.jpg" },
  { n: "唐之韵", y: "", k: "纪录片", p: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2379928596.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "论语里的大智慧", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "中国古诗词动漫", y: "", k: "纪录片", p: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2787129887.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "如果国宝会说话第二季", y: "", k: "2018", p: "https://img.lzipic.com/upload/vod/20220803-1/c43b87bc5b8e0470a5c19603dd615dba.jpg" },
  { n: "千秋诗颂", y: "", k: "2024", p: "https://p1.img.cctvpic.com/photoAlbum/vms/image/5e2b1c55450c515d73516a0f9095b8b9.jpg" },
  ],
  "doc_shuxue": [
  { n: "数学的故事", y: "", k: "一年级", p: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2234877282.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "数学荒岛历险记", y: "", k: "二年级", p: "https://img.lzipic.com/upload/vod/20240510-1/27d259a3e842d8b74732d01f82121c8e.jpg" },
  { n: "数学漫步之旅", y: "", k: "三年级", p: "https://img.dytt-tupian.com/upload/vod/20260509-1/13b69145a6287594d978ccc4bc9453e0.jpg" },
  { n: "解码数学", y: "", k: "四年级", p: "https://img.lzipic.com/upload/vod/20220915-1/7142722710df8e6c43c297efc6b6026b.jpg" },
  { n: "被数学选中的人", y: "", k: "五六年级", p: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2873865263.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "像乌鸦一样思考", y: "", k: "2013", p: "https://img.jisuimage.com/cover/9f085256f8dcc84f8b32ad555c7673e6.jpg" },
  { n: "用动画片学奥数", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "神奇的数字", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "托起人类文明的数学", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  ],
  "doc_yingyu": [
  { n: "DO YOU KNOW", y: "", k: "一年级", p: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2888021908.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "Our Planet", y: "", k: "二年级", p: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2551395076.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "小鞋子", y: "", k: "三年级", p: "https://img.dytt-tupian.com/upload/vod/20250419-1/44437d7a8fb437b35df6cfc536ad7e60.jpg" },
  { n: "糟糕的历史", y: "", k: "四年级", p: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2508818693.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "放牛班的春天", y: "", k: "五六年级", p: "https://img.dytt-tupian.com/upload/vod/20250211-1/e8713e77e36259404e43720e4dd9524b.jpg" },
  { n: "新概念英语", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "小猪佩奇第十季", y: "", k: "2024", p: "https://img.dytt-tupian.com/upload/vod/20250930-1/a667d12239e1ff0bec09b9ba7aa2576f.jpg" },
  { n: "玛泽的故事", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "牛津树", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "汪汪队立大功第十季", y: "", k: "2023", p: "https://img.dytt-tupian.com/upload/vod/20250813-1/cd3cade647d8259026de71a3f91b49bc.jpg" },
  { n: "爱冒险的朵拉2", y: "", k: "2025", p: "https://img.jisuimage.com/cover/6271871c36ced4883bc1f774a53dff9f.jpg" },
  ],
  "doc_lishi": [
  { n: "微观历史秀", y: "", k: "一年级", p: "https://img.lzipic.com/upload/vod/20240328-1/83d20c04e48b22741dbb5d170e05326b.jpg" },
  { n: "历史那些事第二季", y: "", k: "二年级", p: "https://img.lzipic.com/upload/vod/20220414-1/d2cb1153068aa794be1a7f16e16aad14.jpg" },
  { n: "那年那兔那些事儿第五季", y: "", k: "三年级", p: "https://img.dytt-tupian.com/upload/vod/20250711-1/5f403a644655016610840e14946606d9.jpg" },
  { n: "中国通史", y: "", k: "四年级", p: "https://img.lzipic.com/upload/vod/20241021-1/bae5214213027a34ef2efe4e00352207.jpg" },
  { n: "如果历史是一群喵第六季", y: "", k: "五六年级", p: "https://img.dytt-tupian.com/upload/vod/20250326-1/df3199019de4a52823d3546b05882567.jpg" },
  ],
  "doc_dili": [
  { n: "蓝色星球", y: "", k: "一年级", p: "https://img.lzipic.com/upload/vod/20230415-1/f7de7421b789c995c09aac0d0eb428a6.jpg" },
  { n: "地球脉动第三季", y: "", k: "二年级", p: "https://img.dytt-tupian.com/upload/vod/20250630-1/5d5bd585da8af71baab2872cb0b0fb0a.jpg" },
  { n: "美丽中国", y: "", k: "三年级", p: "https://img.lzipic.com/upload/vod/20231008-1/07c58cd6a0fb1818a8eeae62e5b6cfc4.jpg" },
  { n: "冰冻星球第一季", y: "", k: "四年级", p: "https://img.dytt-tupian.com/upload/vod/20250513-1/00acbbeb257b16cd3fb40ce347bc2118.jpg" },
  { n: "航拍中国第四季", y: "", k: "五六年级", p: "https://img.lzipic.com/upload/vod/20230314-1/0368a11a82793a675db78f27f930a7c5.jpg" },
  { n: "微观小世界第一季", y: "", k: "2006", p: "https://img.jisuimage.com/cover/14e51a87e16cd5da8717f98915f90264.jpg" },
  { n: "小小世界", y: "", k: "2022", p: "https://img.dytt-tupian.com/upload/vod/20250207-1/2965c50b88b07625e340017170930632.jpg" },
  ],
  "doc_kexue": [
  { n: "像乌鸦一样思考", y: "", k: "一年级", p: "https://img.jisuimage.com/cover/9f085256f8dcc84f8b32ad555c7673e6.jpg" },
  { n: "我的牛顿教练", y: "", k: "二年级", p: "https://img.lzipic.com/upload/vod/20240716-1/25225a43ed98ddaa9daf51ff219d4387.jpg" },
  { n: "大科学实验", y: "", k: "三年级", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "造物小百科", y: "", k: "四年级", p: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2893183760.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  { n: "平博士密码 第二季", y: "", k: "五六年级", p: "https://img.jisuimage.com/cover/6efa93b4d852fa97617085ff3396742d.jpg" },
  { n: "科学小子席德", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "宇宙时空之旅", y: "", k: "2014", p: "https://img.dytt-tupian.com/upload/vod/20250619-1/eccf7584e6165945881f702429925c81.jpg" },
  { n: "门捷列夫很忙", y: "", k: "2020", p: "https://img.jisuimage.com/cover/74914c02f71597cf86f7fc3b9fb023e9.jpg" },
  { n: "美丽化学", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "我们需要化学", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "种出个地球", y: "", k: "2012", p: "https://img.lzipic.com/upload/vod/20220913-1/705384142ac9cbfac813352f86c871e3.jpg" },
  { n: "工作细胞", y: "", k: "2018", p: "https://img.dytt-tupian.com/upload/vod/20250219-1/115fbb7557debf2d38f775fb097b0ccd.jpg" },
  ],
  "doc_guoqing": [
  { n: "辉煌中国", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "大国外交", y: "", k: "纪录片", p: "https://gitee.com/zhanganno/tvbox/raw/master/doc-ph.png" },
  { n: "创新中国", y: "", k: "纪录片", p: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2581307545.jpg@Referer=https://movie.douban.com/@User-Agent=Mozilla/5.0" },
  ],
};

function mvList(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    out.push({
      vod_id: 'msearch:' + m.n,
      vod_name: m.n,
      vod_pic: m.p,
      vod_remarks: (i + 1) + '. ' + (m.y ? m.y + ' · ' : '') + (m.k || '')
    });
  }
  return out;
}


// =====================================================================
//  ★ 豆瓣榜单（写死）—— 替代原先的实时接口
//  原「⚡高分·全网直搜」依赖 movie.douban.com/j/new_search_subjects，
//  该接口已被豆瓣封禁（"检测到有异常请求从您的IP发出"），分类会空白。
//  现改为写死数据，零请求、永不失效。
// =====================================================================
const DB_TOP250 = [
  { n: "肖申克的救赎", p: "p2934829882", r: "9.7" },
  { n: "霸王别姬", p: "p2911205318", r: "9.6" },
  { n: "泰坦尼克号", p: "p457760035", r: "9.5" },
  { n: "阿甘正传", p: "p510876253", r: "9.5" },
  { n: "千与千寻", p: "p2557573348", r: "9.4" },
  { n: "星际穿越", p: "p2614988097", r: "9.4" },
  { n: "美丽人生", p: "p2578474613", r: "9.5" },
  { n: "这个杀手不太冷", p: "p2913554676", r: "9.4" },
  { n: "盗梦空间", p: "p513344864", r: "9.4" },
  { n: "楚门的世界", p: "p479682972", r: "9.4" },
  { n: "辛德勒的名单", p: "p492406163", r: "9.5" },
  { n: "忠犬八公的故事", p: "p2587099240", r: "9.4" },
  { n: "海上钢琴师", p: "p2914698334", r: "9.3" },
  { n: "疯狂动物城", p: "p2924128964", r: "9.3" },
  { n: "三傻大闹宝莱坞", p: "p579729551", r: "9.2" },
  { n: "机器人总动员", p: "p2934742160", r: "9.3" },
  { n: "放牛班的春天", p: "p2884280708", r: "9.3" },
  { n: "无间道", p: "p2597979873", r: "9.3" },
  { n: "控方证人", p: "p2927451337", r: "9.6" },
  { n: "寻梦环游记", p: "p2505426431", r: "9.1" },
  { n: "大话西游之大圣娶亲", p: "p2455050536", r: "9.2" },
  { n: "熔炉", p: "p1363250216", r: "9.3" },
  { n: "触不可及", p: "p1454261925", r: "9.3" },
  { n: "教父", p: "p616779645", r: "9.3" },
  { n: "哈利·波特与魔法石", p: "p2913781448", r: "9.2" },
  { n: "末代皇帝", p: "p452089833", r: "9.3" },
  { n: "当幸福来敲门", p: "p2220721286", r: "9.1" },
  { n: "龙猫", p: "p2540924496", r: "9.2" },
  { n: "活着", p: "p2597919477", r: "9.3" },
  { n: "怦然心动", p: "p501177648", r: "9.1" },
  { n: "蝙蝠侠：黑暗骑士", p: "p462657443", r: "9.2" },
  { n: "指环王3：王者无敌", p: "p2642829472", r: "9.3" },
  { n: "我不是药神", p: "p2527119568", r: "9.0" },
  { n: "乱世佳人", p: "p1963126880", r: "9.3" },
  { n: "让子弹飞", p: "p1512562287", r: "9.0" },
  { n: "飞屋环游记", p: "p485887754", r: "9.1" },
  { n: "哈尔的移动城堡", p: "p2907583906", r: "9.1" },
  { n: "十二怒汉", p: "p2173577632", r: "9.4" },
  { n: "海蒂和爷爷", p: "p2554525534", r: "9.3" },
  { n: "素媛", p: "p2118532944", r: "9.3" },
  { n: "猫鼠游戏", p: "p453924541", r: "9.1" },
  { n: "天空之城", p: "p2892409201", r: "9.2" },
  { n: "鬼子来了", p: "p2930874010", r: "9.3" },
  { n: "摔跤吧！爸爸", p: "p2401676338", r: "9.0" },
  { n: "少年派的奇幻漂流", p: "p1784592701", r: "9.1" },
  { n: "死亡诗社", p: "p2575465690", r: "9.2" },
  { n: "指环王2：双塔奇兵", p: "p2640236255", r: "9.2" },
  { n: "钢琴家", p: "p1381339291", r: "9.3" },
  { n: "大话西游之月光宝盒", p: "p2561721372", r: "9.0" },
  { n: "绿皮书", p: "p2531065411", r: "8.9" },
  { n: "何以为家", p: "p2875749222", r: "9.1" },
  { n: "闻香识女人", p: "p2550757929", r: "9.1" },
  { n: "大闹天宫", p: "p2184505167", r: "9.4" },
  { n: "黑客帝国", p: "p451926968", r: "9.1" },
  { n: "指环王1：护戒使者", p: "p2197698335", r: "9.1" },
  { n: "罗马假日", p: "p2189265085", r: "9.1" },
  { n: "教父2", p: "p2194138787", r: "9.3" },
  { n: "狮子王", p: "p726659067", r: "9.1" },
  { n: "天堂电影院", p: "p2653054340", r: "9.2" },
  { n: "饮食男女", p: "p1910899751", r: "9.2" },
  { n: "辩护人", p: "p2158166535", r: "9.2" },
  { n: "本杰明·巴顿奇事", p: "p2192535722", r: "9.0" },
  { n: "搏击俱乐部", p: "p1910931622", r: "9.0" },
  { n: "美丽心灵", p: "p1665997400", r: "9.1" },
  { n: "穿条纹睡衣的男孩", p: "p1473670352", r: "9.2" },
  { n: "功夫", p: "p2219011938", r: "8.9" },
  { n: "哈利·波特与死亡圣器(下)", p: "p2913457020", r: "9.0" },
  { n: "两杆大烟枪", p: "p792443418", r: "9.1" },
  { n: "情书", p: "p2648230660", r: "8.9" },
  { n: "音乐之声", p: "p2585102899", r: "9.1" },
  { n: "窃听风暴", p: "p1808872109", r: "9.2" },
  { n: "哈利·波特与阿兹卡班的囚徒", p: "p2913456870", r: "9.0" },
  { n: "阿凡达", p: "p2180085848", r: "8.8" },
  { n: "西西里的美丽传说", p: "p2441988159", r: "8.9" },
  { n: "看不见的客人", p: "p2498971355", r: "8.8" },
  { n: "拯救大兵瑞恩", p: "p1014542496", r: "9.1" },
  { n: "沉默的羔羊", p: "p1593414327", r: "8.9" },
  { n: "小鞋子", p: "p2165511465", r: "9.2" },
  { n: "还有明天", p: "p2918279456", r: "9.3" },
  { n: "蝴蝶效应", p: "p2209066019", r: "8.9" },
  { n: "布达佩斯大饭店", p: "p2183539003", r: "8.9" },
  { n: "飞越疯人院", p: "p792238287", r: "9.1" },
  { n: "禁闭岛", p: "p450262388", r: "8.9" },
  { n: "心灵捕手", p: "p480965695", r: "9.0" },
  { n: "致命魔术", p: "p480383375", r: "8.9" },
  { n: "低俗小说", p: "p1910902213", r: "8.9" },
  { n: "哈利·波特与密室", p: "p2913781951", r: "8.9" },
  { n: "一一", p: "p2923629857", r: "9.1" },
  { n: "超脱", p: "p1305562621", r: "9.0" },
  { n: "喜剧之王", p: "p2917778954", r: "8.8" },
  { n: "致命ID", p: "p2497887020", r: "8.9" },
  { n: "杀人回忆", p: "p1633113220", r: "8.9" },
  { n: "摩登时代", p: "p2263408369", r: "9.3" },
  { n: "加勒比海盗", p: "p1596085504", r: "8.9" },
  { n: "春光乍泄", p: "p465939041", r: "9.0" },
  { n: "海豚湾", p: "p2559579779", r: "9.3" },
  { n: "美国往事", p: "p477229647", r: "9.1" },
  { n: "七宗罪", p: "p2219586434", r: "8.8" },
  { n: "红辣椒", p: "p2794776839", r: "9.0" },
  { n: "唐伯虎点秋香", p: "p2357915564", r: "8.8" },
  { n: "狩猎", p: "p1546987967", r: "9.1" },
  { n: "寄生虫", p: "p2561439800", r: "8.8" },
  { n: "幽灵公主", p: "p2920895053", r: "8.9" },
  { n: "甜蜜蜜", p: "p2223011274", r: "8.9" },
  { n: "蝙蝠侠：黑暗骑士崛起", p: "p1706428744", r: "8.9" },
  { n: "天书奇谭", p: "p2700138245", r: "9.2" },
  { n: "超能陆战队", p: "p2224568669", r: "8.8" },
  { n: "茶馆", p: "p2528965424", r: "9.5" },
  { n: "第六感", p: "p2220184425", r: "8.9" },
  { n: "7号房的礼物", p: "p1816276065", r: "8.9" },
  { n: "爱在日落黄昏时", p: "p2191788134", r: "8.9" },
  { n: "头脑特工队", p: "p2874927470", r: "8.9" },
  { n: "爱在黎明破晓前", p: "p2555762374", r: "8.8" },
  { n: "哈利·波特与火焰杯", p: "p2913456904", r: "8.8" },
  { n: "未麻的部屋", p: "p1351050722", r: "9.1" },
  { n: "被嫌弃的松子的一生", p: "p884763596", r: "8.8" },
  { n: "重庆森林", p: "p792381411", r: "8.8" },
  { n: "借东西的小人阿莉埃蒂", p: "p617533616", r: "8.9" },
  { n: "菊次郎的夏天", p: "p2620392435", r: "8.9" },
  { n: "入殓师", p: "p2707581855", r: "8.9" },
  { n: "断背山", p: "p2169104127", r: "8.8" },
  { n: "剪刀手爱德华", p: "p480956937", r: "8.7" },
  { n: "时空恋旅人", p: "p2070153774", r: "8.8" },
  { n: "勇敢的心", p: "p2455767018", r: "8.9" },
  { n: "玩具总动员3", p: "p1283675359", r: "8.9" },
  { n: "傲慢与偏见", p: "p2016401659", r: "8.7" },
  { n: "驯龙高手", p: "p2210954024", r: "8.8" },
  { n: "新世界", p: "p1903379979", r: "8.9" },
  { n: "消失的爱人", p: "p2221768894", r: "8.7" },
  { n: "无人知晓", p: "p661160053", r: "9.1" },
  { n: "倩女幽魂", p: "p2918554634", r: "8.8" },
  { n: "花样年华", p: "p2918312477", r: "8.8" },
  { n: "色，戒", p: "p453716305", r: "8.7" },
  { n: "一个叫欧维的男人决定去死", p: "p2406624993", r: "8.9" },
  { n: "怪兽电力公司", p: "p2513247938", r: "8.8" },
  { n: "完美的世界", p: "p2190556408", r: "9.1" },
  { n: "教父3", p: "p2169664351", r: "9.0" },
  { n: "九品芝麻官", p: "p648370300", r: "8.8" },
  { n: "小森林 夏秋篇", p: "p2232317770", r: "9.0" },
  { n: "天使爱美丽", p: "p2447590313", r: "8.7" },
  { n: "哪吒闹海", p: "p2532803206", r: "9.2" },
  { n: "阳光灿烂的日子", p: "p2582946597", r: "8.8" },
  { n: "被解救的姜戈", p: "p1800813767", r: "8.8" },
  { n: "侧耳倾听", p: "p456692072", r: "8.9" },
  { n: "幸福终点站", p: "p854757687", r: "8.8" },
  { n: "请以你的名字呼唤我", p: "p2505525050", r: "8.8" },
  { n: "釜山行", p: "p2360940399", r: "8.6" },
  { n: "神偷奶爸", p: "p792776858", r: "8.7" },
  { n: "小森林 冬春篇", p: "p2258078370", r: "9.0" },
  { n: "喜宴", p: "p2249048907", r: "9.0" },
  { n: "萤火之森", p: "p1675053073", r: "8.8" },
  { n: "告白", p: "p689520756", r: "8.8" },
  { n: "机器人之梦", p: "p2928203369", r: "9.1" },
  { n: "七武士", p: "p2215886505", r: "9.3" },
  { n: "头号玩家", p: "p2516578307", r: "8.6" },
  { n: "玛丽和麦克斯", p: "p2923412445", r: "8.9" },
  { n: "模仿游戏", p: "p2922986728", r: "8.8" },
  { n: "心灵奇旅", p: "p2595591069", r: "8.7" },
  { n: "惊魂记", p: "p1021883305", r: "9.0" },
  { n: "大鱼", p: "p692813374", r: "8.8" },
  { n: "背靠背，脸对脸", p: "p2505048077", r: "9.4" },
  { n: "你的名字。", p: "p2910701461", r: "8.5" },
  { n: "血战钢锯岭", p: "p2398141939", r: "8.7" },
  { n: "高山下的花环", p: "p2319879389", r: "9.5" },
  { n: "末路狂花", p: "p1910924635", r: "9.0" },
  { n: "射雕英雄传之东成西就", p: "p2609063922", r: "8.7" },
  { n: "我是山姆", p: "p652417775", r: "9.0" },
  { n: "阳光姐妹淘", p: "p1374786017", r: "8.8" },
  { n: "黑客帝国3：矩阵革命", p: "p443461818", r: "8.8" },
  { n: "恐怖直播", p: "p2016930906", r: "8.7" },
  { n: "谍影重重3", p: "p792223507", r: "8.9" },
  { n: "小丑", p: "p2567198874", r: "8.7" },
  { n: "无间道2", p: "p958008320", r: "8.8" },
  { n: "三块广告牌", p: "p2502943384", r: "8.7" },
  { n: "电锯惊魂", p: "p726839485", r: "8.7" },
  { n: "达拉斯买家俱乐部", p: "p2166160837", r: "8.8" },
  { n: "疯狂原始人", p: "p1867084027", r: "8.7" },
  { n: "疯狂的石头", p: "p712241453", r: "8.6" },
  { n: "绿里奇迹", p: "p767586451", r: "8.9" },
  { n: "雨中曲", p: "p1612355875", r: "9.1" },
  { n: "2001太空漫游", p: "p2926647970", r: "8.9" },
  { n: "爱在午夜降临前", p: "p2074715729", r: "8.8" },
  { n: "海街日记", p: "p2242546753", r: "8.8" },
  { n: "上帝之城", p: "p455677490", r: "9.0" },
  { n: "心迷宫", p: "p2926020289", r: "8.7" },
  { n: "风之谷", p: "p1917567652", r: "8.9" },
  { n: "记忆碎片", p: "p2931989223", r: "8.7" },
  { n: "英雄本色", p: "p2504997087", r: "8.6" },
  { n: "纵横四海", p: "p2931740648", r: "8.8" },
  { n: "恐怖游轮", p: "p2933909877", r: "8.5" },
  { n: "无敌破坏王", p: "p1735642656", r: "8.7" },
  { n: "芙蓉镇", p: "p2575337180", r: "9.3" },
  { n: "魔女宅急便", p: "p456676352", r: "8.8" },
  { n: "牯岭街少年杀人事件", p: "p848381236", r: "8.9" },
  { n: "小偷家族", p: "p2530599636", r: "8.7" },
  { n: "东京教父", p: "p2066810983", r: "9.0" },
  { n: "冰川时代", p: "p1910895719", r: "8.7" },
  { n: "卢旺达饭店", p: "p470419493", r: "8.9" },
  { n: "忠犬八公物语", p: "p2603716224", r: "9.2" },
  { n: "岁月神偷", p: "p456666151", r: "8.7" },
  { n: "白日梦想家", p: "p2893896472", r: "8.6" },
  { n: "遗愿清单", p: "p2676812053", r: "8.7" },
  { n: "爱乐之城", p: "p2934269059", r: "8.4" },
  { n: "花束般的恋爱", p: "p2868462052", r: "8.6" },
  { n: "源代码", p: "p988260245", r: "8.6" },
  { n: "大佛普拉斯", p: "p2505928032", r: "8.7" },
  { n: "荒蛮故事", p: "p2919686972", r: "8.7" },
  { n: "疯狂的麦克斯4：狂暴之路", p: "p2236181653", r: "8.7" },
  { n: "可可西里", p: "p2363208684", r: "8.9" },
  { n: "波西米亚狂想曲", p: "p2549558913", r: "8.6" },
  { n: "你看起来好像很好吃", p: "p709670262", r: "8.9" },
  { n: "贫民窟的百万富翁", p: "p2434249040", r: "8.6" },
  { n: "大红灯笼高高挂", p: "p1254404823", r: "8.8" },
  { n: "城市之光", p: "p2170238828", r: "9.3" },
  { n: "无耻混蛋", p: "p2575043939", r: "8.7" },
  { n: "哈利·波特与死亡圣器(上)", p: "p2913456984", r: "8.6" },
  { n: "终结者2：审判日", p: "p1910909085", r: "8.8" },
  { n: "爆裂鼓手", p: "p2915975989", r: "8.6" },
  { n: "青蛇", p: "p2923862788", r: "8.6" },
  { n: "东邪西毒", p: "p1982176012", r: "8.6" },
  { n: "黑天鹅", p: "p2549648344", r: "8.6" },
  { n: "新龙门客栈", p: "p1421018669", r: "8.7" },
  { n: "千钧一发", p: "p792423963", r: "8.8" },
  { n: "初恋这件小事", p: "p1505312273", r: "8.5" },
  { n: "人工智能", p: "p792257137", r: "8.7" },
  { n: "崖上的波妞", p: "p2627847859", r: "8.6" },
  { n: "彗星来的那一夜", p: "p2187896734", r: "8.6" },
  { n: "虎口脱险", p: "p2399597512", r: "8.9" },
  { n: "哈利·波特与凤凰社", p: "p2913456924", r: "8.6" },
  { n: "雨人", p: "p2353324612", r: "8.7" },
  { n: "海边的曼彻斯特", p: "p2421855655", r: "8.6" },
  { n: "罗生门", p: "p1598883511", r: "8.8" },
  { n: "火星救援", p: "p2264592493", r: "8.5" },
  { n: "恋恋笔记本", p: "p483604864", r: "8.5" },
  { n: "冰雪奇缘", p: "p2151245053", r: "8.5" },
  { n: "真爱至上", p: "p475600770", r: "8.5" },
  { n: "黑客帝国2：重装上阵", p: "p443461390", r: "8.7" },
  { n: "蜘蛛侠：平行宇宙", p: "p2535851348", r: "8.6" },
  { n: "步履不停", p: "p2375245718", r: "8.8" },
  { n: "谍影重重2", p: "p667644866", r: "8.7" },
  { n: "千年女优", p: "p2215102596", r: "8.8" },
  { n: "奇迹男孩", p: "p2507709428", r: "8.6" },
  { n: "战争之王", p: "p792282381", r: "8.7" },
  { n: "攻壳机动队", p: "p2921045013", r: "9.0" },
  { n: "血观音", p: "p2505008756", r: "8.6" },
  { n: "血钻", p: "p1244017073", r: "8.7" },
  { n: "小姐", p: "p2355555424", r: "8.6" },
  { n: "隐藏人物", p: "p2374067318", r: "8.9" },
  { n: "魂断蓝桥", p: "p2351134499", r: "8.8" },
  { n: "谍影重重", p: "p1597183981", r: "8.6" },
];
const DB_HOT = [
  { n: "希望", p: "p2933326871", r: "5.6" },
  { n: "潜伏6", p: "p2931576822", r: "6.6" },
  { n: "人为何要写情书", p: "p2933130655", r: "6.6" },
  { n: "火柴盒大电影", p: "p2935696033", r: "6.1" },
  { n: "功夫女足", p: "p2933860063", r: "6.1" },
  { n: "人性本兽", p: "p2935862659", r: "5.9" },
  { n: "罗斯", p: "p2935294362", r: "8.5" },
  { n: "一个部门的诞生", p: "p2933113603", r: "7.2" },
  { n: "爱情假说", p: "p2935295277", r: "6.6" },
  { n: "瘴气营地的青春性事与死亡", p: "p2935854243", r: "6.7" },
  { n: "给阿嬷的情书", p: "p2931851430", r: "9.3" },
  { n: "蜘蛛侠：崭新之日", p: "p2934276912", r: "7.7" },
  { n: "求救信号", p: "p2935448686", r: "7.2" },
  { n: "年会不能停！2", p: "p2934583425", r: "6.2" },
  { n: "阳光女子合唱团", p: "p2930838026", r: "7.3" },
  { n: "致命录像带：混音带", p: "p2935914663", r: "5.6" },
  { n: "庆州纪行", p: "p2934096838", r: "6.3" },
  { n: "家弑服务", p: "p2932673659", r: "7.1" },
  { n: "逃出布迪秀", p: "p2936309806", r: "7.2" },
  { n: "大濛", p: "p2925804842", r: "8.2" },
  { n: "魔方小姐", p: "p2933654136", r: "6.8" },
  { n: "抓特务", p: "p2933198755", r: "7.2" },
  { n: "峡湾", p: "p2935830446", r: "8.0" },
  { n: "特立独行", p: "p2933638302", r: "6.6" },
  { n: "逃出绝命街", p: "p2934546481", r: "5.5" },
  { n: "起义", p: "p2934146453", r: "6.3" },
  { n: "卖冰淇淋的人", p: "p2936042502", r: "5.6" },
  { n: "八仙！", p: "p2934074566", r: "8.2" },
  { n: "500英里", p: "p2932686404", r: "7.6" },
  { n: "激情邀约", p: "p2932993239", r: "7.3" },
  { n: "魔法少女小圆：沃普尔吉斯的回天", p: "p2923423510", r: "6.5" },
  { n: "大学炸弹客", p: "p2936115679", r: "6.4" },
  { n: "挽救计划", p: "p2931370692", r: "8.6" },
  { n: "夜王", p: "p2929673775", r: "7.7" },
  { n: "坂本日常 真人版", p: "p2930561218", r: "6.6" },
  { n: "揭秘日", p: "p2933170423", r: "6.3" },
  { n: "玩具总动员5", p: "p2933391462", r: "8.0" },
  { n: "寻找艾米丽", p: "p2932264143", r: "7.5" },
  { n: "群体", p: "p2932381127", r: "6.1" },
  { n: "双喜", p: "p2930587034", r: "7.5" },
  { n: "护肝人", p: "p2934139047", r: "5.9" },
  { n: "怪化猫：蛇神", p: "p2927963782", r: "7.1" },
  { n: "诺曼底72小时", p: "p2932334501", r: "8.2" },
  { n: "故土", p: "p2935691855", r: "7.6" },
  { n: "突如其来", p: "p2931445409", r: "7.7" },
  { n: "电动维纳斯", p: "p2934251452", r: "7.3" },
  { n: "后室", p: "p2933327977", r: "6.6" },
  { n: "爱情抓马", p: "p2929524191", r: "6.9" },
  { n: "穿普拉达的女王2", p: "p2930952195", r: "6.3" },
  { n: "金谍行动", p: "p2933012346", r: "6.1" },
  { n: "东京出租车", p: "p2924658739", r: "8.0" },
  { n: "盒子里的羊", p: "p2932581748", r: "5.8" },
  { n: "小黄人与大怪兽", p: "p2933539994", r: "6.5" },
  { n: "一夜限定", p: "p2935635427", r: "6.3" },
  { n: "歪心狼对阵ACME", p: "p2934713062", r: "7.3" },
  { n: "怒之杀", p: "p2935069903", r: "5.6" },
  { n: "绵羊侦探团", p: "p2931958860", r: "7.5" },
  { n: "牢笼鬼魂", p: "p2929720334", r: "6.7" },
  { n: "吉伊卡哇：人鱼之岛的秘密", p: "p2931938481", r: "8.2" },
  { n: "夏日红岩", p: "p2935557577", r: "7.8" },
  { n: "不成功穿越指南", p: "p2933696920", r: "6.5" },
  { n: "消失的人", p: "p2931601069", r: "6.9" },
  { n: "巴黎绽放的星辰", p: "p2924196532", r: "7.2" },
  { n: "与王生活的男人", p: "p2928835899", r: "7.5" },
  { n: "超级少女", p: "p2932426049", r: "5.0" },
  { n: "海洋奇缘：启航", p: "p2933001869", r: "6.5" },
  { n: "真爱留声", p: "p2932556024", r: "7.1" },
  { n: "鬼玩人6：炼狱", p: "p2932170733", r: "6.5" },
  { n: "寒战1994", p: "p2931924492", r: "6.8" },
  { n: "疯狂动物城2", p: "p2926605350", r: "8.3" },
  { n: "星球大战：曼达洛人与古古", p: "p2931769584", r: "7.4" },
  { n: "森中有林", p: "p2931808301", r: "6.2" },
  { n: "戴高乐之战：淬炼时代", p: "p2932756467", r: "7.7" },
  { n: "我看见两朵一样的云", p: "p2933087672", r: "5.6" },
  { n: "洛杉矶劫案", p: "p2929956678", r: "6.5" },
  { n: "杀的就是你", p: "p2928787017", r: "6.8" },
  { n: "镖人：风起大漠", p: "p2929760596", r: "7.4" },
  { n: "去你的岛", p: "p2934742318", r: "7.5" },
  { n: "一击3", p: "p2935341851", r: "6.3" },
  { n: "平行故事", p: "p2931634117", r: "6.3" },
  { n: "请求救援", p: "p2928975987", r: "6.6" },
  { n: "迈克尔·杰克逊：巨星之路", p: "p2931063628", r: "7.4" },
  { n: "苦涩的圣诞节", p: "p2929655310", r: "6.7" },
  { n: "我，许可", p: "p2932103692", r: "8.0" },
  { n: "后来的我们", p: "p2927580106", r: "7.3" },
  { n: "今晚正好", p: "p2931924321", r: "5.9" },
  { n: "雨光", p: "p2934727389", r: "5.8" },
  { n: "10间敢死队", p: "p2931584782", r: "6.6" },
  { n: "茫然女王", p: "p2930593644", r: "8.0" },
  { n: "飞行家", p: "p2928725889", r: "7.1" },
  { n: "地母", p: "p2925709618", r: "7.1" },
  { n: "花绿青绽放之日", p: "p2928185066", r: "5.7" },
  { n: "米诺陶", p: "p2933907728", r: "7.0" },
  { n: "惊蛰无声", p: "p2929759786", r: "5.7" },
  { n: "名侦探柯南：高速公路的堕天使", p: "p2931453638", r: "5.5" },
  { n: "幸运有八只触手", p: "p2931434593", r: "7.7" },
  { n: "公民义警", p: "p2932845357", r: "6.3" },
  { n: "像我这样的爱情", p: "p2919474943", r: "7.2" },
  { n: "呼啸山庄", p: "p2930238411", r: "6.2" },
  { n: "蔷薇修剪术", p: "p2931083682", r: "5.3" },
  { n: "机动战士高达 闪光的哈萨维 喀耳刻的魔女", p: "p2926009741", r: "7.9" },
  { n: "阿凡达：火与烬", p: "p2925983114", r: "7.5" },
  { n: "她回来的那天", p: "p2931572036", r: "7.4" },
  { n: "怪屋", p: "p2931169677", r: "5.7" },
  { n: "女子当参政", p: "p2932512852", r: "9.1" },
  { n: "超时空辉夜姬！", p: "p2928772586", r: "8.3" },
  { n: "幽旅巫咒", p: "p2931049468", r: "6.1" },
  { n: "准备好了没2：我来了", p: "p2929654337", r: "6.0" },
  { n: "浴血黑帮：不朽传奇", p: "p2928174437", r: "6.4" },
  { n: "飞驰人生3", p: "p2929427346", r: "7.1" },
  { n: "托尼", p: "p2933405221", r: "6.8" },
  { n: "最后孤屋", p: "p2934739676", r: "5.4" },
  { n: "河狸变身计划", p: "p2929759261", r: "7.3" },
  { n: "三国第一部：争洛阳", p: "p2936473615", r: "8.0" },
  { n: "袒露", p: "p2934933066", r: "6.3" },
  { n: "鬼上车", p: "p2931590787", r: "6.0" },
  { n: "极限审判", p: "p2929006010", r: "7.2" },
  { n: "蜂蜜的针", p: "p2930744969", r: "6.6" },
  { n: "耳语者", p: "p2934088022", r: "5.9" },
  { n: "爆弹", p: "p2923847565", r: "7.1" },
  { n: "拨乱行动", p: "p2934308192", r: "5.7" },
  { n: "真人快打2", p: "p2932271729", r: "5.7" },
  { n: "我的妈耶", p: "p2930427050", r: "6.0" },
  { n: "我们的救赎", p: "p2935124161", r: "6.6" },
  { n: "遇见世界", p: "p2923972376", r: "7.6" },
  { n: "长尾豹历险记", p: "p2927515013", r: "7.0" },
  { n: "藤本树 17-26", p: "p2925051474", r: "8.2" },
  { n: "惊天魔盗团3", p: "p2926399098", r: "5.5" },
  { n: "杀木池", p: "p2930165787", r: "5.4" },
  { n: "最佳舞伴", p: "p2935920442", r: "6.7" },
  { n: "菜肉馄饨", p: "p2928450378", r: "7.1" },
  { n: "巅峰猎杀", p: "p2931974717", r: "6.3" },
  { n: "木乃伊", p: "p2930019594", r: "6.1" },
  { n: "女仆日记", p: "p2934910303", r: "7.3" },
  { n: "平场之月", p: "p2923847559", r: "7.5" },
  { n: "巴兰：少年寻踪", p: "p2934548788", r: "6.7" },
  { n: "灵魂摆渡·蝴蝶梦", p: "p2935132883", r: "6.5" },
  { n: "惊声尖笑6", p: "p2932169476", r: "4.9" },
  { n: "从邦子开始的故事", p: "p2931640588", r: "6.6" },
  { n: "铁血战士：杀戮之地", p: "p2926391728", r: "7.3" },
  { n: "哆啦A梦：新·大雄的海底鬼岩城", p: "p2925049672", r: "6.6" },
  { n: "灵魂伴侣", p: "p2934590754", r: "5.9" },
  { n: "奈义日记", p: "p2931442507", r: "6.6" },
  { n: "群星闪耀时", p: "p2934427975", r: "7.4" },
  { n: "安昂传奇：最后的气宗", p: "p2934419386", r: "7.2" },
  { n: "天才游戏", p: "p2931149949", r: "5.6" },
  { n: "索命舞娘", p: "p2931022629", r: "6.5" },
  { n: "想你了", p: "p2933938761", r: "6.8" },
  { n: "惊变28年2：白骨圣殿", p: "p2927456643", r: "6.4" },
  { n: "用武之地", p: "p2928312004", r: "7.1" },
  { n: "匹诺曹：弦断", p: "p2932250663", r: "5.6" },
  { n: "铁肺", p: "p2932888253", r: "5.6" },
  { n: "夜巡毒枭", p: "p2935254634", r: "6.8" },
  { n: "拼桌", p: "p2930539333", r: "6.3" },
  { n: "M.I.S.S.I.O.N. 歌剧般的潜入搜查官", p: "p2934261763", r: "5.7" },
  { n: "最后的曙光", p: "p2935325350", r: "5.5" },
  { n: "荣光与暗影", p: "p2931227654", r: "7.3" },
  { n: "好兆头：最终季", p: "p2931623328", r: "7.4" },
  { n: "惩罚者：最后一击", p: "p2931453005", r: "6.7" },
  { n: "趣塔德庄园", p: "p2926612844", r: "7.2" },
  { n: "废用身", p: "p2928395163", r: "7.1" },
  { n: "暗黑新娘！", p: "p2929036260", r: "6.3" },
  { n: "如何大赚一笔", p: "p2929342062", r: "6.1" },
  { n: "奇幻变身大冒险", p: "p2930602730", r: "7.5" },
  { n: "人生海海", p: "p2930456002", r: "6.9" },
  { n: "女士优先", p: "p2932533733", r: "6.3" },
  { n: "夺命航班", p: "p2933925290", r: "5.7" },
  { n: "东北警察故事3", p: "p2929406352", r: "7.3" },
  { n: "猎杀游戏", p: "p2926819330", r: "5.7" },
  { n: "万物生灵：2025圣诞特别集", p: "p2927816384", r: "8.9" },
  { n: "所爱之人", p: "p2932424335", r: "6.3" },
  { n: "战时离婚指南", p: "p2935543995", r: "6.9" },
  { n: "菲律宾女孩", p: "p2929719783", r: "6.2" },
  { n: "糖精", p: "p2931816349", r: "6.0" },
  { n: "小家伙", p: "p2931411548", r: "6.9" },
  { n: "超级马力欧银河大电影", p: "p2930472372", r: "6.9" },
  { n: "银魂剧场版 -吉原炎上篇-", p: "p2928249117", r: "7.6" },
  { n: "全信没收", p: "p2925091095", r: "6.6" },
  { n: "福尔摩斯小姐3", p: "p2933549672", r: "5.6" },
  { n: "逃亡者", p: "p2934307715", r: "5.5" },
  { n: "扣篮梦工厂", p: "p2928781145", r: "7.3" },
  { n: "绿液惊魂", p: "p2930565623", r: "5.7" },
  { n: "罗宾汉之死", p: "p2928747130", r: "5.5" },
  { n: "汪汪队立大功大电影3：勇闯恐龙岛", p: "p2933198257", r: "7.1" },
  { n: "新狂蟒之灾", p: "p2928305678", r: "5.0" },
  { n: "百分之十(电影版)", p: "p2932583933", r: "6.8" },
  { n: "侵略机器", p: "p2929615413", r: "6.4" },
  { n: "最后之吻", p: "p2935674819", r: "5.5" },
  { n: "抖擞", p: "p2931629972", r: "6.2" },
  { n: "宇宙巨人：希曼崛起", p: "p2932404714", r: "5.3" },
  { n: "一切从头来过", p: "p2926570640", r: "7.1" },
  { n: "致命之旅", p: "p2931255112", r: "6.4" },
  { n: "盛夏假期遇见爱", p: "p2925091594", r: "6.6" },
  { n: "我要你的性", p: "p2933747952", r: "5.5" },
  { n: "闯入泽田美由纪的蛤蟆乐园", p: "p2930203339", r: "6.9" },
  { n: "蝙蝠侠：骑士陨落 第一部：骑士陨落", p: "p2934315813", r: "7.3" },
  { n: "魔法坏女巫2", p: "p2927288302", r: "5.6" },
  { n: "寻秦记", p: "p2928387071", r: "5.9" },
  { n: "迷失的露西", p: "p2932999447", r: "8.5" },
  { n: "银河特急 Milky✩Subway 各站停车前往剧场", p: "p2928188292", r: "8.0" },
  { n: "告知信", p: "p2929220450", r: "6.9" },
  { n: "奇迹梦之队", p: "p2930436712", r: "6.6" },
  { n: "马腾你别走", p: "p2927571605", r: "6.7" },
  { n: "人工情报", p: "p2929169445", r: "6.4" },
  { n: "我心里危险的东西 剧场版", p: "p2929620611", r: "7.4" },
  { n: "苍蝇", p: "p2932843089", r: "6.5" },
  { n: "泡泡糖女孩", p: "p2930610622", r: "8.5" },
  { n: "核战边缘", p: "p2934422508", r: "6.3" },
  { n: "熊出没·年年有熊", p: "p2930029531", r: "6.4" },
  { n: "两人一生一狗", p: "p2931234734", r: "8.1" },
  { n: "庇护之地", p: "p2929018970", r: "5.9" },
  { n: "单程夜航", p: "p2932198103", r: "7.1" },
  { n: "不过是上班", p: "p2928696109", r: "6.1" },
  { n: "监狱雄心", p: "p2935135742", r: "5.7" },
  { n: "安全屋", p: "p2926710124", r: "6.4" },
  { n: "草莓月亮", p: "p2928062825", r: "7.3" },
  { n: "孤军突围", p: "p2934676376", r: "5.5" },
  { n: "黑煞女2", p: "p2929630818", r: "6.5" },
  { n: "内幕", p: "p2927787808", r: "5.6" },
  { n: "金多宝", p: "p2929176538", r: "7.1" },
  { n: "营救夜莺", p: "p2932967700", r: "6.2" },
  { n: "星河入梦", p: "p2929616093", r: "6.7" },
  { n: "黑牢城", p: "p2930561208", r: "6.3" },
  { n: "不久，就要永别了", p: "p2927600456", r: "6.8" },
  { n: "美味倒数", p: "p2931770345", r: "6.7" },
  { n: "海绵宝宝：深海大冒险", p: "p2926962492", r: "6.7" },
  { n: "青年华盛顿", p: "p2934860167", r: "6.5" },
  { n: "富士子", p: "p2930652446", r: "6.9" },
  { n: "惊声尖叫7", p: "p2929000829", r: "5.2" },
  { n: "熊猫计划之部落奇遇记", p: "p2929984579", r: "4.9" },
  { n: "追恶", p: "p2931405407", r: "6.1" },
  { n: "明日之幸", p: "p2925063079", r: "6.8" },
  { n: "爆水管", p: "p2928838563", r: "5.7" },
  { n: "一直在这里", p: "p2935345290", r: "6.9" },
  { n: "我们不是陌生人", p: "p2929810703", r: "5.8" },
  { n: "特工迷阵", p: "p2928835359", r: "5.8" },
  { n: "过家家", p: "p2928389426", r: "6.1" },
  { n: "未来", p: "p2929952659", r: "5.7" },
  { n: "远方的魔法树", p: "p2930967249", r: "6.4" },
  { n: "黑色电话2", p: "p2926043538", r: "6.0" },
  { n: "男人没有好东西", p: "p2930195779", r: "6.6" },
  { n: "佐贺偶像是传奇 梦想银河乐园", p: "p2923801264", r: "8.6" },
  { n: "四减三", p: "p2928440706", r: "6.9" },
  { n: "旁观者", p: "p2926587850", r: "6.3" },
  { n: "非传统浪漫关系", p: "p2928951663", r: "5.3" },
  { n: "火拼", p: "p2929616105", r: "5.9" },
  { n: "永生战士2", p: "p2924685252", r: "6.6" },
  { n: "放送禁止 我的三位妻子", p: "p2928307575", r: "6.4" },
  { n: "我的妻子哭了", p: "p2929940118", r: "6.8" },
  { n: "匿杀", p: "p2928464781", r: "5.3" },
  { n: "贼爱时尚", p: "p2931173550", r: "6.3" },
  { n: "我的邻居不是人", p: "p2927744510", r: "5.5" },
  { n: "寻女朝圣路", p: "p2928387188", r: "6.9" },
  { n: "人夫总动员", p: "p2932949867", r: "6.0" },
  { n: "巴霍巴利王：史诗", p: "p2924288194", r: "7.1" },
  { n: "木挽町复仇记", p: "p2925050015", r: "7.2" },
  { n: "情歌恋习曲", p: "p2931079661", r: "6.9" },
  { n: "黄色领带", p: "p2927249268", r: "7.2" },
  { n: "剧场版 暗杀教室 大家的时间", p: "p2928094579", r: "7.1" },
  { n: "你的错误：伦敦版", p: "p2932422556", r: "6.2" },
  { n: "救赎", p: "p2930368136", r: "6.5" },
  { n: "下一个台风", p: "p2925490243", r: "6.9" },
  { n: "炎上", p: "p2923426812", r: "6.2" },
  { n: "眼眸", p: "p2933774966", r: "5.7" },
  { n: "孔雀舞曲", p: "p2929694596", r: "6.8" },
  { n: "较量3", p: "p2904245527", r: "6.4" },
  { n: "家中低语", p: "p2931898359", r: "6.5" },
  { n: "狂唱下半场", p: "p2932318966", r: "6.4" },
  { n: "停下那辆火车！", p: "p2932112794", r: "5.7" },
  { n: "为你遗憾", p: "p2924020002", r: "5.7" },
  { n: "加里市", p: "p2932178115", r: "6.7" },
  { n: "我们的错误", p: "p2924486089", r: "5.6" },
  { n: "金童", p: "p2925737188", r: "6.1" },
  { n: "星与月是天上的洞", p: "p2924949043", r: "5.8" },
  { n: "末路讨债人", p: "p2933559560", r: "6.0" },
  { n: "正在缩小的男人", p: "p2925850190", r: "6.4" },
  { n: "你留下的痕迹", p: "p2926393077", r: "5.6" },
  { n: "绚烂一刻", p: "p2929239462", r: "6.7" },
  { n: "蓝色男孩事件", p: "p2923532908", r: "6.5" },
  { n: "我当你兄弟", p: "p2930412656", r: "6.2" },
  { n: "疑婴夜生", p: "p2929941606", r: "5.5" },
  { n: "咒术回战 涩谷事变×死灭回游 剧场版", p: "p2926215249", r: "6.6" },
  { n: "欢乐岁月", p: "p2926313868", r: "7.2" },
  { n: "神奇数字马戏团：谢幕演出", p: "p2931554845", r: "7.3" },
  { n: "披萨电影", p: "p2930678995", r: "6.3" },
  { n: "你的心会破碎", p: "p2932876455", r: "5.9" },
  { n: "四十次约会", p: "p2932934024", r: "5.8" },
  { n: "家庭计划2", p: "p2925996324", r: "5.7" },
  { n: "同事以上，恋人未满", p: "p2932055185", r: "5.7" },
  { n: "运钞大劫案", p: "p2927694476", r: "5.7" },
  { n: "眨眼之间", p: "p2928140000", r: "6.6" },
  { n: "今夜，就算这份爱恋从世界上消失", p: "p2928784316", r: "6.7" },
  { n: "手遮天", p: "p2928726979", r: "6.4" },
  { n: "悬崖绝壁", p: "p2929026062", r: "6.0" },
  { n: "魔法坏女巫：奇幻之夜", p: "p2929166541", r: "8.0" },
  { n: "东北恋哥3：冬天里的一把火", p: "p2929800004", r: "6.2" },
  { n: "邻里谜案", p: "p2934094868", r: "6.3" },
  { n: "蓝调之歌", p: "p2927659417", r: "6.5" },
  { n: "走心男", p: "p2931314479", r: "5.8" },
  { n: "放飞旅行团", p: "p2925547864", r: "5.6" },
  { n: "人生大弟震", p: "p2932598439", r: "5.9" },
  { n: "瑞典救援暗线", p: "p2930128358", r: "7.0" },
  { n: "低弧慢球", p: "p2933548415", r: "6.1" },
  { n: "大蛇5：怪兽都市", p: "p2929349631", r: "5.5" },
  { n: "LAST MAN -初恋-", p: "p2923816992", r: "5.8" },
  { n: "我独自蜜月", p: "p2927750627", r: "6.2" },
  { n: "帖木儿", p: "p2934466425", r: "5.7" },
  { n: "浪漫杀手", p: "p2925761300", r: "5.9" },
  { n: "杀戮屋", p: "p2933576472", r: "5.9" },
  { n: "谍杀风暴", p: "p2930237804", r: "5.6" },
  { n: "冰湖行动", p: "p2926896501", r: "5.6" },
  { n: "夺命网红2", p: "p2928165084", r: "5.5" },
  { n: "如何输掉一场人气竞赛", p: "p2929181769", r: "5.9" },
];

function listStatic(arr, pg) {
  const lim = 60;
  const page = parseInt(pg || '1', 10) || 1;
  const st = (page - 1) * lim;
  return {
    page: page,
    pagecount: Math.max(1, Math.ceil(arr.length / lim)),
    limit: lim,
    total: arr.length,
    list: arr.slice(st, st + lim).map(function(m, i) {
      return {
        vod_id: 'msearch:' + m.n,
        vod_name: m.n,
        vod_pic: dlPic(m.p),
        vod_remarks: (st + i + 1) + '.' + (m.r ? ' 豆瓣 ' + m.r : '')
      };
    })
  };
}

export default {
  init(ext) { },

  home(filter) {
    return JSON.stringify({
      class: [
        { type_id: 'marvel',   type_name: '🦸漫威观影合集' },
        { type_id: 'timeline', type_name: '🕐漫威剧情时间线' },
        { type_id: 'doc_yuwen',   type_name: '📖语文·人文' },
        { type_id: 'doc_shuxue',  type_name: '🔢数学·思维' },
        { type_id: 'doc_yingyu',  type_name: '🔤英语·启蒙' },
        { type_id: 'doc_lishi',   type_name: '🏛历史·故事' },
        { type_id: 'doc_dili',    type_name: '🌍地理·自然' },
        { type_id: 'doc_kexue',   type_name: '🔬科学·探索' },
        { type_id: 'doc_guoqing', type_name: '🇨🇳国情·家国' },
        { type_id: 'hot_search',  type_name: '🔥热门电影·全网直搜' },
        { type_id: 'top_search',  type_name: '⚡Top250·全网直搜' },
        { type_id: 'selftest',    type_name: '🧪自检(不联网)' }
      ]
    });
  },

  homeVod() { return JSON.stringify({ list: [] }); },

  category(tid, pg, filter, extend) {
    const page = parseInt(pg || '1', 10) || 1;
    if (tid === 'marvel') {
      return JSON.stringify({ page: 1, pagecount: 1, limit: 60, total: MARVEL.length, list: mvList(MARVEL) });
    }
    if (tid === 'timeline') {
      return JSON.stringify({ page: 1, pagecount: 1, limit: 60, total: TIMELINE.length, list: mvList(TIMELINE) });
    }
    if (DOC[tid]) {
      const arr = DOC[tid];
      return JSON.stringify({ page: 1, pagecount: 1, limit: 80, total: arr.length, list: mvList(arr) });
    }
    if (tid === 'selftest') {
      return JSON.stringify({
        page: 1, pagecount: 1, limit: 20, total: 2,
        list: [
          { vod_id: 'selftest:1', vod_name: '自检影片①（脚本已运行）', vod_pic: '', vod_remarks: '不联网也能出' },
          { vod_id: 'selftest:2', vod_name: '自检影片②', vod_pic: '', vod_remarks: '说明脚本OK' }
        ]
      });
    }
    let list = [];
    try {
      if (tid === 'top_search') return JSON.stringify(listStatic(DB_TOP250, pg));
    if (tid === 'hot_search') return JSON.stringify(listStatic(DB_HOT, pg));
    const useSearch = (tid === 'high_search' || tid === 'top_search');
      list = (tid === 'top250' || tid === 'top_search')
        ? listTop250(page, useSearch)
        : listHighScore(page, useSearch);
    } catch (e) {
      list = [];
    }
    return JSON.stringify({
      page: page, pagecount: page + 1, limit: 20, total: 9999, list: list
    });
  },

  detail(id) {
    let v = null;
    try { v = detailOf(id); } catch (e) { v = null; }
    return JSON.stringify({ list: v ? [v] : [] });
  },

  search(key, quick) { return JSON.stringify({ list: [] }); },

  // id 形如 "0|19647"（采集站下标|该站影片id）
  play(flag, id, flags) {
    let url = '';
    try {
      const p = String(id || '').split('|');
      url = resolvePlay(parseInt(p[0], 10) || 0, p[1] || '');
    } catch (e) { url = ''; }
    return JSON.stringify({ parse: 0, url: url, header: '' });
  }
};
