// @name 如意资源
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/如意资源.js

const OmniBox = require("omnibox_sdk");

/**
 * 配置信息
 */
const ruyiConfig = {
  // 主API地址
  apiUrls: [
    "https://cj.rycjapi.com/api.php/provide/vod",
    "https://cj.rytvapi.com/api.php/provide/vod",
    "https://bycj.rytvapi.com/api.php/provide/vod"
  ],
  // 图片域名
  imgHosts: [
    "https://ps.ryzypics.com",
    "https://ry-pic.com",
    "https://img.lzzyimg.com"
  ],
  // 弹幕API配置
  danmuApi: process.env.DANMU_API || "",
  // 请求头
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://cj.rycjapi.com/'
  },
  // 超时时间(毫秒)
  timeout: 15000,
  // 批量获取详情时的批次大小
  batchSize: 20
};

// 播放页URL探测模式
const PLAY_URL_PATTERNS = [
  (vodId) => `https://www.ryzyw.com/index.php/vod/play/id/${vodId}.html`,
  (vodId) => `https://cj.rycjapi.com/play/${vodId}.html`
];

// ========== 缓存机制 ==========
let cachedClasses = null;           // 缓存分类数据
let cachedClassFilters = null;      // 缓存分类筛选器
const detailCache = new Map();      // 缓存视频详情（避免重复请求）
const REQUEST_CACHE_TTL = 3600000;  // 缓存1小时

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
  if (data) {
    OmniBox.log("info", `[如意资源] ${message}: ${JSON.stringify(data)}`);
  } else {
    OmniBox.log("info", `[如意资源] ${message}`);
  }
};

const logError = (message, error) => {
  OmniBox.log("error", `[如意资源] ${message}: ${error.message || error}`);
};

const logWarn = (message) => {
  OmniBox.log("warn", `[如意资源] ${message}`);
};

/**
 * 元数据编解码
 */
const encodeMeta = (obj) => {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
};

const decodeMeta = (str) => {
  try {
    const raw = Buffer.from(str || "", "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

/**
 * 发送HTTP请求 - 支持备用域名自动切换
 */
async function request(url, options = {}) {
  // 如果传入的是完整URL，直接请求
  if (url && url.startsWith('http')) {
    try {
      const response = await OmniBox.request(url, {
        method: options.method || "GET",
        headers: options.headers || ruyiConfig.headers,
        timeout: options.timeout || ruyiConfig.timeout,
        body: options.body
      });
      if (response.statusCode !== 200) {
        throw new Error(`HTTP ${response.statusCode}`);
      }
      return JSON.parse(response.body);
    } catch (error) {
      logError(`请求失败: ${url}`, error);
      throw error;
    }
  }
  
  // 否则使用API列表轮询
  let lastError = null;
  
  for (let i = 0; i < ruyiConfig.apiUrls.length; i++) {
    const apiUrl = ruyiConfig.apiUrls[i];
    try {
      let requestUrl = apiUrl;
      if (options.params) {
        const params = new URLSearchParams(options.params);
        requestUrl = `${apiUrl}?${params.toString()}`;
      }
      
      const response = await OmniBox.request(requestUrl, {
        method: options.method || "GET",
        headers: options.headers || ruyiConfig.headers,
        timeout: options.timeout || ruyiConfig.timeout,
        body: options.body
      });

      if (response.statusCode !== 200) {
        throw new Error(`HTTP ${response.statusCode}`);
      }

      const data = JSON.parse(response.body);
      
      if (i > 0) {
        logInfo(`切换到备用API: ${apiUrl}`);
      }
      
      return data;
    } catch (error) {
      lastError = error;
      logWarn(`API ${apiUrl} 请求失败: ${error.message}`);
      continue;
    }
  }
  
  throw lastError || new Error("所有API都请求失败");
}

/**
 * 获取完整图片 URL
 */
const getPicUrl = (path) => {
  if (!path) return '';
  if (path === '<nil>' || path === 'nil' || path === 'null') return '';
  
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  if (path.startsWith('/')) {
    for (const imgHost of ruyiConfig.imgHosts) {
      return `${imgHost}${path}`;
    }
  }
  
  if (path && !path.startsWith('/')) {
    for (const imgHost of ruyiConfig.imgHosts) {
      return `${imgHost}/${path}`;
    }
  }
  
  return path;
};

/**
 * 预处理标题
 */
function preprocessTitle(title) {
  if (!title) return "";
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

/**
 * 将中文数字转换为阿拉伯数字
 */
function chineseToArabic(cn) {
  const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (!isNaN(cn)) return parseInt(cn, 10);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === '十') return 10 + map[cn[1]];
    if (cn[1] === '十') return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
}

/**
 * 从标题中提取集数数字
 */
function extractEpisode(title) {
  if (!title) return "";
  const processedTitle = preprocessTitle(title).trim();
  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));
  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];
  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];
  return "";
}

/**
 * 构建用于弹幕匹配的文件名
 */
function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return "";
  if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;
  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) {
      return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
    }
  }
  return vodName;
}

/**
 * 构建刮削后的集数名称
 */
function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  if (mapping.episodeName) {
    return mapping.episodeName;
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
    );
    if (hit?.name) {
      return `${hit.episodeNumber}.${hit.name}`;
    }
  }
  return originalName;
}

/**
 * 构建刮削后的弹幕文件名
 */
function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
  if (!scrapeData) {
    return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
  }
  if (scrapeType === 'movie') {
    return scrapeData.title || fallbackVodName;
  }
  const title = scrapeData.title || fallbackVodName;
  const seasonAirYear = scrapeData.seasonAirYear || '';
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
}

/**
 * 匹配弹幕
 */
async function matchDanmu(fileName) {
  if (!ruyiConfig.danmuApi || !fileName) return [];
  try {
    const matchUrl = `${ruyiConfig.danmuApi}/api/v2/match`;
    const response = await OmniBox.request(matchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ruyiConfig.headers['User-Agent'],
      },
      body: JSON.stringify({ fileName })
    });

    if (response.statusCode !== 200) return [];
    const matchData = JSON.parse(response.body || '{}');
    if (!matchData.isMatched) return [];
    const episodeId = matchData.matches?.[0]?.episodeId;
    if (!episodeId) return [];
    return [{ name: '弹幕', url: `${ruyiConfig.danmuApi}/api/v2/comment/${episodeId}?format=xml` }];
  } catch (error) {
    return [];
  }
}

/**
 * 格式化视频列表数据
 */
const formatList = (data) => {
  if (!Array.isArray(data)) return [];

  return data.filter(i => i && i.vod_id && String(i.vod_id) !== '0').map(i => {
    let pic = '';
    if (i.vod_pic && i.vod_pic !== '<nil>') pic = getPicUrl(i.vod_pic);
    else if (i.vod_img && i.vod_img !== '<nil>') pic = getPicUrl(i.vod_img);
    else if (i.pic && i.pic !== '<nil>') pic = getPicUrl(i.pic);
    
    return {
      vod_id: String(i.vod_id),
      vod_name: i.vod_name || '未知标题',
      vod_pic: pic,
      vod_remarks: i.vod_remarks || (i.vod_year ? `${i.vod_year}` : ''),
      vod_year: i.vod_year || ''
    };
  });
};

/**
 * 批量获取视频详情
 */
async function batchGetVideoDetails(videoIds) {
  if (!videoIds || videoIds.length === 0) return new Map();
  
  const resultMap = new Map();
  const uncachedIds = [];
  
  // 先从缓存获取
  for (const id of videoIds) {
    if (detailCache.has(id)) {
      resultMap.set(id, detailCache.get(id));
    } else {
      uncachedIds.push(id);
    }
  }
  
  if (uncachedIds.length === 0) return resultMap;
  
  // 分批请求未缓存的数据
  for (let i = 0; i < uncachedIds.length; i += ruyiConfig.batchSize) {
    const batch = uncachedIds.slice(i, i + ruyiConfig.batchSize);
    try {
      const res = await request('', {
        params: { ac: 'videolist', ids: batch.join(',') }
      });
      
      if (Array.isArray(res.list)) {
        for (const item of res.list) {
          if (!item || typeof item !== 'object') continue;
          const vodId = String(item.vod_id);
          
          // 获取图片
          let pic = '';
          if (item.vod_pic && item.vod_pic !== '<nil>') pic = getPicUrl(item.vod_pic);
          else if (item.vod_img && item.vod_img !== '<nil>') pic = getPicUrl(item.vod_img);
          else if (item.pic && item.pic !== '<nil>') pic = getPicUrl(item.pic);
          
          const detail = {
            vod_pic: pic,
            vod_year: item.vod_year || '',
            vod_area: item.vod_area || '',
            type_name: item.type_name || '',
            vod_actor: item.vod_actor || '',
            vod_director: item.vod_director || '',
            vod_content: item.vod_content || ''
          };
          
          // 存入缓存
          detailCache.set(vodId, detail);
          resultMap.set(vodId, detail);
        }
      }
    } catch (error) {
      logError(`批量获取详情失败: ${batch.join(',')}`, error);
    }
  }
  
  return resultMap;
}

/**
 * 补全视频封面信息
 */
async function enrichVideosWithDetails(videos) {
  if (!Array.isArray(videos) || videos.length === 0) return videos;
  
  // 收集需要补全封面的视频ID
  const needDetailIds = [];
  const videoMap = new Map();
  
  for (const video of videos) {
    if (!video.vod_pic || video.vod_pic === '') {
      needDetailIds.push(video.vod_id);
      videoMap.set(video.vod_id, video);
    }
  }
  
  if (needDetailIds.length === 0) return videos;
  
  logInfo(`需要补全封面的视频数: ${needDetailIds.length}`);
  
  // 批量获取详情
  const detailsMap = await batchGetVideoDetails(needDetailIds);
  
  // 更新视频信息
  for (const [vodId, detail] of detailsMap) {
    const video = videoMap.get(vodId);
    if (video) {
      if (detail.vod_pic) video.vod_pic = detail.vod_pic;
      if (detail.vod_year) video.vod_year = detail.vod_year;
    }
  }
  
  const withPic = videos.filter(v => v.vod_pic).length;
  logInfo(`补全后: 有封面=${withPic}/${videos.length}`);
  
  return videos;
}

/**
 * 解析播放源
 */
const parsePlaySources = (vodItem) => {
  const playSources = [];
  const vodId = vodItem.vod_id;
  const vodName = vodItem.vod_name;
  const playFrom = vodItem.vod_play_from || '默认线路';
  const playUrl = vodItem.vod_play_url || '';
  
  if (playUrl) {
    const episodes = playUrl.split('#').map((item, index) => {
      const parts = item.split('$');
      const episodeName = parts[0] || `第${index + 1}集`;
      const directUrl = parts[1] || '';
      
      const fid = `${vodId}#${index}`;
      const playMeta = {
        sid: vodId,
        fid: fid,
        v: vodName,
        e: index + 1,
        url: directUrl,
        isDirect: true
      };
      
      return {
        name: episodeName,
        playId: `${directUrl}|||${encodeMeta(playMeta)}`,
        _fid: fid,
        _rawName: episodeName
      };
    }).filter(ep => ep.playId);
    
    if (episodes.length > 0) {
      const sources = playFrom.split(',');
      for (const source of sources) {
        playSources.push({
          name: source.trim(),
          episodes: episodes
        });
      }
    }
  }
  
  return playSources;
};

/**
 * 智能探测播放页URL
 */
async function getPlayPageUrlSmart(vodId) {
  for (const pattern of PLAY_URL_PATTERNS) {
    try {
      const testUrl = pattern(vodId);
      const headResponse = await OmniBox.request(testUrl, {
        method: 'HEAD',
        timeout: 3000
      }).catch(() => null);
      
      if (headResponse && headResponse.statusCode === 200) {
        return testUrl;
      }
    } catch (e) {}
  }
  return `https://www.ryzyw.com/index.php/vod/play/id/${vodId}.html`;
}

/* ============================================================================
 * 首页和分类功能
 * ============================================================================ */

/**
 * 获取首页内容和分类
 */
const getHomeContent = async () => {
  // 使用缓存
  if (cachedClasses) {
    return { class: cachedClasses, filters: cachedClassFilters || {} };
  }
  
  try {
    logInfo('========== 开始获取首页分类 ==========');
    
    const res = await request('', {
      params: { ac: 'list', pg: 1, pagesize: 1 }
    });
    
    const classes = [];
    const filters = {};
    
    if (res.class && Array.isArray(res.class)) {
      for (const item of res.class) {
        // 只取一级分类（type_pid === 0）
        if (item.type_pid === 0) {
          const tid = String(item.type_id);
          const tName = item.type_name;
          classes.push({ type_id: tid, type_name: tName });
        }
      }
    }
    
    // 缓存分类数据
    cachedClasses = classes;
    cachedClassFilters = filters;
    
    logInfo(`获取到 ${classes.length} 个主分类`);
    logInfo('========== 首页获取完成 ==========');
    
    return { class: classes, filters: filters };
  } catch (e) {
    logError('获取首页分类失败', e);
    const defaultClasses = [
      { type_id: '1', type_name: '电影片' },
      { type_id: '2', type_name: '连续剧' },
      { type_id: '3', type_name: '综艺片' },
      { type_id: '4', type_name: '动漫片' }
    ];
    return { class: defaultClasses, filters: {} };
  }
};

/**
 * 获取分类视频列表
 */
const getCategoryList = async (tid, pg = 1) => {
  try {
    logInfo('获取分类列表', { tid, pg });
    
    const params = {
      ac: 'list',
      t: tid,
      pg: pg,
      pagesize: 20
    };
    
    const res = await request('', { params });
    
    let list = formatList(res.list || []);
    list = await enrichVideosWithDetails(list);
    
    logInfo('分类列表获取成功', { count: list.length, page: pg, totalPages: res.pagecount });
    
    return {
      list: list,
      page: parseInt(pg),
      pagecount: res.pagecount || 1,
      limit: 20
    };
  } catch (e) {
    logError('获取分类列表失败', e);
    return { list: [], page: pg, pagecount: pg, limit: 20 };
  }
};

/**
 * 获取首页推荐视频
 */
const getRecommendList = async () => {
  try {
    logInfo('正在获取首页推荐');
    
    const res = await request('', {
      params: { ac: 'list', pg: 1, pagesize: 20 }
    });
    
    let videos = formatList(res.list || []);
    videos = await enrichVideosWithDetails(videos);
    
    logInfo('首页推荐获取成功', { count: videos.length });
    return videos;
  } catch (e) {
    logError('获取首页推荐失败', e);
    return [];
  }
};

/* ============================================================================
 * OmniBox 接口实现
 * ============================================================================ */

async function home(params) {
  try {
    logInfo('处理首页请求');
    const homeData = await getHomeContent();
    const recommendList = await getRecommendList();
    
    return {
      class: homeData.class,
      filters: homeData.filters,
      list: recommendList
    };
  } catch (error) {
    logError('获取首页数据失败', error);
    return { class: [], filters: {}, list: [] };
  }
}

async function category(params) {
  try {
    const categoryId = params.categoryId;
    const page = params.page || 1;
    
    if (!categoryId) {
      throw new Error("分类ID不能为空");
    }
    
    logInfo(`获取分类数据: categoryId=${categoryId}, page=${page}`);
    
    const result = await getCategoryList(categoryId, page);
    
    if (page === 1) {
      const homeData = await getHomeContent();
      result.filters = homeData.filters[categoryId] || [];
    }
    
    return result;
  } catch (error) {
    logError('获取分类数据失败', error);
    return { page: 1, pagecount: 0, list: [] };
  }
}

async function search(params) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = params.page || 1;
    
    if (!keyword) {
      return { page: 1, pagecount: 0, list: [] };
    }
    
    logInfo(`搜索视频: keyword=${keyword}, page=${page}`);
    
    const res = await request('', {
      params: { ac: 'list', wd: keyword, pg: page, pagesize: 30 }
    });
    
    let list = formatList(res.list || []);
    
    // 搜索词二次过滤（轻量级，在已获取的数据中过滤）
    const searchKeyword = String(keyword).trim().toLowerCase();
    list = list.filter(item => {
      const name = (item.vod_name || '').toLowerCase();
      return name.includes(searchKeyword);
    });
    
    list = await enrichVideosWithDetails(list);
    
    logInfo('搜索完成', { keyword, count: list.length });
    
    return {
      list: list.slice(0, 20),
      page: parseInt(page),
      pagecount: res.pagecount || 1,
      total: res.total || 0
    };
  } catch (error) {
    logError('搜索视频失败', error);
    return { page: 1, pagecount: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = params.videoId;
    
    if (!videoId) {
      throw new Error("视频ID不能为空");
    }
    
    logInfo(`获取视频详情: videoId=${videoId}`);
    
    // 使用批量获取函数
    const detailsMap = await batchGetVideoDetails([videoId]);
    const detailData = detailsMap.get(videoId);
    
    if (!detailData) {
      return { list: [] };
    }
    
    // 获取完整视频信息
    const res = await request('', {
      params: { ac: 'videolist', ids: videoId }
    });
    
    let vod = null;
    if (Array.isArray(res.list) && res.list.length > 0) {
      const item = res.list[0];
      vod = {
        vod_id: String(item.vod_id || ''),
        vod_name: String(item.vod_name || ''),
        vod_pic: detailData.vod_pic,
        type_name: String(item.type_name || detailData.type_name || ''),
        vod_year: String(item.vod_year || detailData.vod_year || ''),
        vod_area: String(item.vod_area || detailData.vod_area || ''),
        vod_remarks: String(item.vod_remarks || ''),
        vod_actor: String(item.vod_actor || detailData.vod_actor || ''),
        vod_director: String(item.vod_director || detailData.vod_director || ''),
        vod_content: String(item.vod_content || detailData.vod_content || '').trim(),
        vod_play_sources: parsePlaySources(item)
      };
    }
    
    if (!vod) {
      return { list: [] };
    }
    
    // 刮削处理
    
    logInfo(`详情获取成功: ${vod.vod_name}`);
    return { list: [vod] };
  } catch (error) {
    logError('获取视频详情失败', error);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const rawPlayId = params.playId || '';
    const flag = params.flag || '';
    const vodId = params.vodId || '';
    
    let playUrl = rawPlayId;
    let vodName = '';
    let episodeName = '';
    let isDirectAddress = false;
    
    if (rawPlayId.includes('|||')) {
      const [mainPlayId, metaB64] = rawPlayId.split('|||');
      const meta = decodeMeta(metaB64 || '');
      vodName = meta.v || '';
      episodeName = meta.e || '';
      isDirectAddress = meta.isDirect || false;
      
      if (isDirectAddress) {
        playUrl = mainPlayId;
      } else if (mainPlayId.startsWith('need_resolve:')) {
        const resolveVodId = mainPlayId.split(':')[1] || meta.sid;
        if (resolveVodId) {
          const playPageUrl = await getPlayPageUrlSmart(resolveVodId);
          playUrl = playPageUrl;
        }
      } else {
        playUrl = mainPlayId;
      }
    }
    
    // 刮削元数据处理
    let scrapedDanmuFileName = '';
    try {
      const sourceVideoId = vodId || (rawPlayId.includes('|||') ? (decodeMeta(rawPlayId.split('|||')[1] || '').sid || '') : '');
      if (sourceVideoId) {
        const sourceId = `spider_source_${context.sourceId}_${sourceVideoId}`;
        const metadata = await OmniBox.getScrapeMetadata(sourceId);
        
        if (metadata && metadata.scrapeData) {
          const meta = rawPlayId.includes('|||') ? decodeMeta(rawPlayId.split('|||')[1] || '') : {};
          const mapping = (metadata.videoMappings || []).find(m => m?.fileId === meta.fid);
          
          scrapedDanmuFileName = buildScrapedDanmuFileName(
            metadata.scrapeData,
            metadata.scrapeType || '',
            mapping,
            vodName,
            episodeName
          );
          
          if (metadata.scrapeData.title) vodName = metadata.scrapeData.title;
          if (mapping?.episodeName) episodeName = mapping.episodeName;
        }
      }
    } catch (error) {
      logError("获取刮削元数据失败", error);
    }
    
    let resolvedUrl = playUrl;
    let resolvedHeader = {};
    let parse = 1;
    
    const isDirectPlayable = /\.(m3u8|mp4|flv|avi|mkv|ts)(?:\?|#|$)/i.test(playUrl || '');
    
    if (isDirectPlayable || isDirectAddress) {
      parse = 0;
    } else if (/^https?:\/\//i.test(playUrl || '')) {
      try {
        const sniffResult = await OmniBox.sniffVideo(playUrl);
        if (sniffResult && sniffResult.url) {
          resolvedUrl = sniffResult.url;
          resolvedHeader = sniffResult.header || {};
          parse = 0;
        }
      } catch (sniffError) {}
    }
    
    const response = {
      urls: [{ name: '默认线路', url: resolvedUrl }],
      flag: flag,
      header: resolvedHeader,
      parse: parse
    };
    
    if (ruyiConfig.danmuApi) {
      let fileName = '';
      if (vodName) {
        fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
      }
      if (fileName) {
        const danmakuList = await matchDanmu(fileName);
        if (danmakuList && danmakuList.length > 0) response.danmaku = danmakuList;
      }
    }
    
    return response;
  } catch (error) {
    logError('获取播放地址失败', error);
    return { urls: [], parse: 0, header: {} };
  }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
