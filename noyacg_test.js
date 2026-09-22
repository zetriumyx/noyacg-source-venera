/** @type {import('./_venera_.js')} */

/**
 * NoyACG comic source for Venera
 *
 * 站点为 JSON API 架构：
 *   POST {base}/api/login            body: user=&pass=       -> Set-Cookie: NOY_SESSION
 *   POST {base}/api/booklist_v2      body: page=N            -> { info: [], len: N }
 *   POST {base}/api/search_v2        body: info=&type=de|tag&sort=&page=
 *   POST {base}/api/getbookinfo      body: bid=ID            -> { Bid, Bookname, Author, Ptag, Len, ... }
 *   POST {base}/api/readLeaderboard  body: page=&type=day|week|moon
 *   POST {base}/api/favLeaderboard   body: page=&type=day|week|moon
 *   POST {base}/api/proportion       body: page=
 *
 * 新版 web API（axios baseURL=/api，form 编码，请求头 allow-adult）:
 *   POST /api/v4/signin/record, /api/v4/signin/sign                      签到
 *   POST /api/bigtaglist                                                 标签总表
 *   GET  /api/v4/book/{bid}                -> {data:{book:{info}, chapters:{categories:[{id,name}], data:{[catId]:[{id,name,count,sort}]}}}}
 *   GET  /api/v4/comment/book/{bid}/comments?page=N                      评论
 *   GET  /api/v4/comment/book/{bid}/comment/{cid}/replies?page=N          回复
 *   POST /api/v4/comment/book/{bid}/comment  content=&reply_id=&platform=web&hide_ip=
 *
 * 图片: https://{imageDomain}/{bid}/{n}.webp , 封面 {bid}/m1.webp , 需要 Referer
 * 有章节的书: https://{imageDomain}/{bid}/{chapterId}/{n}.webp
 *
 * 注意：站点域名经常变动，可在设置中修改。
 */

class Noyacg extends ComicSource {
    name = "NoyACG 測試版"

    key = "noyacg_test"

    version = "1.4.0"

    minAppVersion = "1.6.0"

    /// 更新检查地址（测试版指向本仓库中的测试文件）
    url = "https://cdn.jsdelivr.net/gh/zetriumyx/noyacg-source-venera@main/noyacg_test.js"

    static pageSize = 20

    /// 站点标签。已去除指向未成年人形象的标签。
    static tags = [
        "全彩",
        "長筒襪",
        "原創",
        "雙馬尾",
        "巨乳",
        "中出",
        "性玩具",
        "姐妹",
        "百合",
        "無修正",
        "自慰",
    ]

    /// 排行项编码 -> [api 路径, type 参数]（与站点榜单页一致）
    static rankMap = {
        "rday": ["readLeaderboard", "day"],
        "rweek": ["readLeaderboard", "week"],
        "rmoon": ["readLeaderboard", "moon"],
        "fday": ["favLeaderboard", "day"],
        "fweek": ["favLeaderboard", "week"],
        "fmoon": ["favLeaderboard", "moon"],
        "prop": ["proportion", ""],
        "fs": ["favoritesrecommend", ""],
    }

    /// 注意: 选项值不能包含 `-`, 该字符被用于分隔 value 与 text
    static rankingOptions = [
        "rday-今日閱讀榜",
        "rweek-週閱讀榜",
        "rmoon-月閱讀榜",
        "fday-今日收藏榜",
        "fweek-週收藏榜",
        "fmoon-月收藏榜",
        "prop-高質榜",
        "fs-收藏推薦",
    ]

    get domain() {
        let d = this.loadSetting('domain')
        if (!d || String(d).trim() === '') d = 'noymanga.com'
        return String(d).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    }

    get baseUrl() {
        return `https://${this.domain}`
    }

    get imageDomain() {
        let d = this.loadSetting('imageDomain')
        if (!d || String(d).trim() === '') d = 'img.noy.asia'
        return String(d).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    }

    get imageBaseUrl() {
        return `https://${this.imageDomain}`
    }

    get session() {
        let s = this.loadData('session')
        if (!s) return ''
        return String(s)
    }

    /**
     * 从响应头中提取 NOY_SESSION
     */
    extractSession(res) {
        let headers = res.headers || {}
        let raw = null
        for (let k in headers) {
            if (String(k).toLowerCase() === 'set-cookie') {
                raw = headers[k]
                break
            }
        }
        if (!raw) return null
        if (Array.isArray(raw)) raw = raw.join('; ')
        let m = /NOY_SESSION=([^;]+)/.exec(String(raw))
        return m ? m[1] : null
    }

    /**
     * 站点内容类型过滤（请求头 allow-adult）
     * 站点取值: 'both' 顯示所有內容 / 'true' 僅成人內容 / 'false' 僅全年齡內容
     */
    get allowAdult() {
        let v = this.loadSetting('allowAdult')
        if (v === 'true' || v === 'false' || v === 'both') return v
        return 'both'
    }

    headers(withSession) {
        let h = {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `${this.baseUrl}/`,
            'Origin': this.baseUrl,
            'Accept': 'application/json, text/plain, */*',
            'allow-adult': this.allowAdult,
        }
        if (withSession !== false && this.session) {
            h['Cookie'] = `NOY_SESSION=${this.session}`
        }
        return h
    }

    /**
     * 新版 web API 状态码判定: 200 / "200" / "ok" 均视为成功
     */
    static isOk(status) {
        return status === 200 || status === 'ok' || status === '200'
    }

    /**
     * App 的 page 转成站点 API 的 page。
     * 实测：App 搜索界面显示 Page 1 时，传入的 page 已是 1（并非 0），
     * 站点 API 也是 1-based，因此直接使用；page<1 时按第 1 页处理。
     * （此前错误地 +1，导致 App 显示的是第 2 页数据）
     */
    static pageToApi(page) {
        let p = Number(page)
        if (!isFinite(p) || p < 1) return 1
        return Math.floor(p)
    }

    /// 记录最近的请求，供诊断工具比对（最多 20 条）
    recordRequest(method, url, body) {
        if (!this._reqLog) this._reqLog = []
        let line = `${method} ${url}${body ? ' | ' + body : ''}`
        if (line.length > 160) line = line.slice(0, 160) + '…'
        this._reqLog.push(line)
        if (this._reqLog.length > 20) this._reqLog.shift()
    }

    /**
     * 站点排序取值: '' | new | views | favorites | rating
     * 空字符串 = 站点默认排序（搜索接口实测 sort 为空）
     */
    static normalizeSort(options) {
        let s = (options && options[0] !== undefined && options[0] !== null) ? String(options[0]) : ''
        if (s === 'default') return ''               // 站点默认（相关度）
        if (s === 'bid' || s === 'new') return 'new'
        if (s === 'views' || s === 'favorites' || s === 'rating') return s
        return 'new'                                 // 未指定/非法 → 最新
    }

    /**
     * 新版 web API 请求。
     * 前端为 axios(baseURL=/api)，form 编码，拦截器附加 allow-adult 头。
     * @param path {string} - 不含 /api 前缀，如 /v4/signin/sign
     * @param params {object?}
     */
    async apiPost(path, params, retry) {
        let body = ''
        if (params) {
            let parts = []
            for (let k in params) {
                let v = params[k]
                if (v === undefined || v === null) continue
                parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            }
            body = parts.join('&')
        }
        let h = this.headers()
        // allow-adult 由 headers() 统一提供
        h['Accept'] = 'application/json, text/plain, */*'
        this.recordRequest('POST', `${this.baseUrl}/api${path}`, body)
        if (path === '/v4/search/fetch') this._lastSearchBody = body
        let res = await Network.post(`${this.baseUrl}/api${path}`, h, body)
        if (res.status !== 200) {
            throw `Invalid status code ${res.status}`
        }
        let json
        try {
            json = JSON.parse(res.body)
        } catch (e) {
            throw 'Invalid response'
        }
        if (json && json.status === 'login') {
            if (retry === false) throw 'Login expired'
            await this.doLogin(null, null)
            return await this.apiPost(path, params, false)
        }
        return json
    }

    /**
     * 新版 web API 的 GET 请求（详情、评论等使用）
     * @param path {string} - 不含 /api 前缀，如 /v4/book/123
     * @param params {object?}
     */
    async apiGet(path, params, retry) {
        let url = `${this.baseUrl}/api${path}`
        if (params) {
            let parts = []
            for (let k in params) {
                let v = params[k]
                if (v === undefined || v === null) continue
                parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            }
            if (parts.length > 0) url += `?${parts.join('&')}`
        }
        let h = this.headers()
        // allow-adult 由 headers() 统一提供
        h['Accept'] = 'application/json, text/plain, */*'
        this.recordRequest('GET', url, '')
        let res = await Network.get(url, h)
        if (res.status !== 200) {
            throw `Invalid status code ${res.status}`
        }
        let json
        try {
            json = JSON.parse(res.body)
        } catch (e) {
            throw 'Invalid response'
        }
        if (json && json.status === 'login') {
            if (retry === false) throw 'Login expired'
            await this.doLogin(null, null)
            return await this.apiGet(path, params, false)
        }
        return json
    }

    /**
     * 探测辅助：发起一次请求并返回「状态 + 结构 + 响应片段」的单行摘要
     * @param label {string}
     * @param method {string} - 'GET' | 'POST'
     * @param path {string} - 含 /api 前缀的完整路径
     * @param withSession {boolean}
     * @param body {string?}
     */
    async probe(label, method, path, withSession, body) {
        try {
            let h = this.headers(withSession)
        // allow-adult 由 headers() 统一提供
            h['Accept'] = 'application/json, text/plain, */*'
            let res
            if (method === 'GET') {
                res = await Network.get(`${this.baseUrl}${path}`, h)
            } else {
                res = await Network.post(`${this.baseUrl}${path}`, h, body || '')
            }
            let keys = ''
            try {
                let j = JSON.parse(res.body)
                if (Array.isArray(j)) {
                    keys = `[array ${j.length}]`
                } else if (j && typeof j === 'object') {
                    keys = `{${Object.keys(j).join(',')}}`
                } else {
                    keys = String(j)
                }
            } catch (e) {
                keys = 'not-json'
            }
            let preview = String(res.body || '').replace(/\s+/g, ' ').slice(0, 80)
            return `${label}: ${res.status} ${keys}\n    ${preview}`
        } catch (e) {
            return `${label}: ERROR ${e}`
        }
    }

    /// 本地日期, 用于判断当日是否已签到
    get today() {
        let d = new Date()
        let m = d.getMonth() + 1
        let day = d.getDate()
        return `${d.getFullYear()}-${m < 10 ? '0' + m : m}-${day < 10 ? '0' + day : day}`
    }

    /**
     * 签到记录: {status, data:[{weekday}], continuous, today}
     */
    async loadSignInRecord() {
        return await this.apiPost('/v4/signin/record', {})
    }

    /**
     * 执行签到: {status, continuous}
     */
    async signIn() {
        return await this.apiPost('/v4/signin/sign', {})
    }

    /**
     * 自动签到。已登录且当日未签到时执行，成功写入 lastSignInDate。
     * @param showResult {boolean}
     * @returns {Promise<{already: boolean, continuous: number} | null>}
     */
    async autoSignIn(showResult) {
        if (this.loadSetting('autoSignIn') === false) return null
        if (!this.session) return null
        if (this.loadData('lastSignInDate') === this.today) return null
        try {
            let rec = await this.loadSignInRecord()
            if (!Noyacg.isOk(rec.status)) return null
            let continuous = Number(rec.continuous)
            if (!isFinite(continuous) || continuous < 0) continuous = 0
            if (rec.today) {
                this.saveData('lastSignInDate', this.today)
                return {already: true, continuous: continuous}
            }
            let res = await this.signIn()
            if (!Noyacg.isOk(res.status)) return null
            let next = Number(res.continuous)
            if (!isFinite(next) || next < 0) next = continuous + 1
            this.saveData('lastSignInDate', this.today)
            if (showResult) {
                UI.showMessage(`签到成功，连续 ${next} 天`)
            }
            return {already: false, continuous: next}
        } catch (e) {
            console.log(`Auto sign in failed: ${e}`)
            return null
        }
    }

    /// 站点标签中不采用的项目：仅匹配明确指向未成年人形象的表述。
    /// 成人角色扮演类标签（學生、制服、JK 等）不在其列，正常使用。
    static blockedTagPattern = /蘿莉|萝莉|loli|幼女|兒童|儿童|正太|小學生|小学生|未成年|幼交/i

    /**
     * 内置屏蔽词 + 用户自定义屏蔽词（只增不减）
     */
    get blockedPattern() {
        let extra = this.loadSetting('extraBlockedTags')
        if (!extra || String(extra).trim() === '') return Noyacg.blockedTagPattern
        let words = []
        for (let w of String(extra).split(/[,，\s]+/)) {
            let t = w.trim()
            if (t === '') continue
            words.push(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        }
        if (words.length === 0) return Noyacg.blockedTagPattern
        return new RegExp(`(?:${Noyacg.blockedTagPattern.source})|(?:${words.join('|')})`, 'i')
    }

    /**
     * 站点分类标签: GET/POST /api/bigtaglist -> {status, data:[{tag, search[], cover}]}
     */
    async loadTags() {
        let json = await this.apiPost('/bigtaglist', {})
        if (!Noyacg.isOk(json.status)) {
            this.tagStats = {total: 0, filtered: 0}
            return []
        }
        let data = json.data
        if (!Array.isArray(data)) {
            this.tagStats = {total: 0, filtered: 0}
            return []
        }
        let tags = []
        let filtered = 0
        let pattern = this.blockedPattern
        for (let item of data) {
            // 优先使用单词标签: 旧接口 search_v2 的 type=tag 只接受单个标签词
            let t = item.tag
            if (!t && item.search && item.search.length > 0) {
                t = item.search[0]
            }
            if (!t) continue
            if (pattern.test(t)) {
                filtered++
                continue
            }
            if (tags.indexOf(t) === -1) tags.push(t)
        }
        this.tagStats = {total: data.length, filtered: filtered}
        return tags
    }

    /**
     * 将标签写入分类页的「標籤」分区
     */
    applyTags(tags) {
        if (!tags || tags.length === 0) return
        this.saveData('tags', JSON.stringify(tags))
        let parts = this.category.parts
        for (let part of parts) {
            if (part.name === '標籤') {
                part.categories = tags
                part.categoryParams = tags
            }
        }
    }

    /**
     * 拉取并应用标签列表
     */
    async refreshTags(showDialog) {
        try {
            let tags = await this.loadTags()
            if (tags.length === 0) throw 'Failed to load tags'
            this.applyTags(tags)
            if (showDialog) {
                let stats = this.tagStats || {total: tags.length, filtered: 0}
                let msg = `Total: ${stats.total}\nLoaded: ${tags.length}`
                if (stats.filtered > 0) {
                    msg += `\nFiltered: ${stats.filtered}`
                }
                UI.showDialog('Success', msg, [
                    {text: 'OK', callback: () => {}}
                ])
            }
            return tags
        } catch (e) {
            if (showDialog) {
                UI.showDialog('Failed', String(e), [
                    {text: 'OK', callback: () => {}}
                ])
            }
            return []
        }
    }

    /**
     * 登录。不传参时使用已保存的账号密码。
     */
    async doLogin(user, pwd) {
        if (!user) {
            user = this.loadData('username')
            pwd = this.loadData('password')
        }
        if (!user || !pwd) {
            throw 'Login expired'
        }
        let res = await Network.post(
            `${this.baseUrl}/api/login`,
            this.headers(false),
            `user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pwd)}`
        )
        if (res.status !== 200) {
            throw 'Login failed'
        }
        let session = this.extractSession(res)
        if (!session) {
            throw 'Login failed'
        }
        this.saveData('session', session)
        this.saveData('username', user)
        this.saveData('password', pwd)
        Network.setCookies(this.baseUrl, [
            new Cookie({name: 'NOY_SESSION', value: session, domain: this.domain})
        ])
        return 'ok'
    }

    /**
     * 发送 api 请求。返回 ["login"] 或 401 时自动重新登录并重试一次。
     */
    async request(path, body, retry) {
        let res = await Network.post(`${this.baseUrl}${path}`, this.headers(), body)
        if (res.status === 401) {
            if (retry === false) throw 'Login expired'
            await this.doLogin(null, null)
            return await this.request(path, body, false)
        }
        if (res.status !== 200) {
            throw `Invalid status code ${res.status}`
        }
        let json
        try {
            json = JSON.parse(res.body)
        } catch (e) {
            throw 'Invalid response'
        }
        if (Array.isArray(json) && json.length === 1 && json[0] === 'login') {
            if (retry === false) throw 'Login expired'
            await this.doLogin(null, null)
            return await this.request(path, body, false)
        }
        return json
    }

    /**
     * 从对象中获取第一个存在的键值
     */
    static pick(obj, keys) {
        if (!obj) return null
        for (let k of keys) {
            let v = obj[k]
            if (v !== undefined && v !== null && v !== '') return v
        }
        return null
    }

    /**
     * 解析列表项。字段: Bid, Bookname, Author, Ptag
     */
    parseComicItem(item) {
        let id = String(Noyacg.pick(item, ['Bid', 'bid', 'ID', 'id']) || '')
        let title = String(Noyacg.pick(item, ['Bookname', 'bookname', 'Title', 'Name']) || '')
        let author = String(Noyacg.pick(item, ['Author', 'author', 'Uploader']) || '')
        let ptag = Noyacg.pick(item, ['Ptag', 'ptag', 'Tags', 'tags'])
        let tags = []
        if (ptag) {
            tags = String(ptag).split(' ').filter((e) => e !== '')
        }
        return new Comic({
            id: id,
            title: title,
            subtitle: author,
            cover: this.coverUrl(id),
            tags: tags,
            description: '',
        })
    }

    /**
     * 解析新版搜索/列表条目。
     * 字段: id, name, author, description, tags, pname, otag, source, adult, mode, status, publish_year, views, favorites, rating_sum
     */
    parseComicV4(item) {
        let rawId = Noyacg.pick(item, ['id', 'Bid', 'bid'])
        let id = rawId === null ? '' : String(rawId)
        if (id.charAt(0) === '-') id = id.substring(1)
        let title = String(Noyacg.pick(item, ['name', 'Bookname', 'Title']) || '')
        let author = String(Noyacg.pick(item, ['author', 'Author']) || '')
        let desc = Noyacg.pick(item, ['description', 'Description', 'Intro'])
        let tags = []
        for (let key of ['tags', 'otag', 'pname']) {
            let v = item[key]
            if (Array.isArray(v)) {
                for (let t of v) {
                    let s = String(t)
                    if (s !== '' && tags.indexOf(s) === -1) tags.push(s)
                }
            }
        }
        return new Comic({
            id: id,
            title: title,
            subtitle: author,
            cover: this.coverUrl(id),
            tags: tags,
            description: desc ? String(desc) : '',
        })
    }

    /**
     * 新版搜索响应: {status, data:[...], count:N}
     */
    parseSearchV4(json) {
        if (!Noyacg.isOk(json.status)) {
            return {comics: [], maxPage: 1}
        }
        let list = Array.isArray(json.data) ? json.data : []
        let count = Number(json.count || 0)
        let comics = []
        for (let item of list) {
            // 动画条目走另一个图片域名，漫画源内跳过
            if (item && item.source === 'stream') continue
            let c = this.parseComicV4(item)
            if (c.id) comics.push(c)
        }
        let maxPage = count > 0 ? Math.max(1, Math.ceil(count / Noyacg.pageSize)) : 1
        return {comics: comics, maxPage: maxPage}
    }

    /**
     * 拉取新版详情 GET/POST /api/v4/book/{id}，自动尝试多种请求方式
     * @returns {Promise<object|null>} 成功返回 {status:'ok', data:{...}}
     */
    async fetchBookV4(id) {
        let attempts = [
            ['GET', true],
            ['GET', false],
            ['POST', true],
        ]
        let lastErr = null
        let relogged = false
        for (let i = 0; i < attempts.length; i++) {
            let method = attempts[i][0]
            let withSession = attempts[i][1]
            try {
                let h = this.headers(withSession)
        // allow-adult 由 headers() 统一提供
                h['Accept'] = 'application/json, text/plain, */*'
                let url = `${this.baseUrl}/api/v4/book/${encodeURIComponent(id)}`
                let res = (method === 'GET')
                    ? await Network.get(url, h)
                    : await Network.post(url, h, '')
                if (res.status !== 200) {
                    lastErr = `status ${res.status}`
                    continue
                }
                let json
                try {
                    json = JSON.parse(res.body)
                } catch (e) {
                    lastErr = 'invalid json'
                    continue
                }
                if (json && json.status === 'login') {
                    lastErr = 'login required'
                    // cookie 失效时尝试重新登录一次
                    if (!relogged && withSession && this.loadData('username')) {
                        relogged = true
                        try {
                            await this.doLogin(null, null)
                        } catch (e) {
                            console.log(`relogin failed: ${e}`)
                        }
                    }
                    continue
                }
                if (Noyacg.isOk(json.status) && json.data) {
                    return json
                }
                lastErr = `status=${JSON.stringify(json.status)}`
            } catch (e) {
                lastErr = e
            }
        }
        console.log(`fetchBookV4(${id}) failed: ${lastErr}`)
        return null
    }

    /**
     * 调用站点搜索接口，自动尝试多组参数（站点对空值/缺省值的处理未知，
     * 依次尝试直到拿到结果；全部有响应但为空时返回空结果，全部失败返回 null）
     * @param value {string} - 关键词
     * @param mode {string} - '' | tag | author
     * @param sort {string} - new | views | favorites | rating
     * @param pageNum {number} - 1-based
     * @returns {Promise<{comics: Comic[], maxPage: number} | null>}
     */
    async searchQuery(value, mode, sort, pageNum) {
        // mode: ''(关键词) / tag(标签) / author(作者)
        // sort: 透传用户选择；'' 表示站点默认相关度，undefined/null 视为 new
        let s = (sort === undefined || sort === null) ? 'new' : String(sort)
        let variants = []
        if (mode) {
            variants.push({mode: mode, sort: s, type: '', page: pageNum, finished: ''})
            variants.push({mode: mode, sort: 'new', type: 'all', page: pageNum, finished: 'all'})
        } else {
            variants.push({mode: '', sort: s, type: '', page: pageNum, finished: ''})
            variants.push({mode: 'default', sort: s, type: '', page: pageNum, finished: ''})
            variants.push({mode: '', sort: 'new', type: 'all', page: pageNum, finished: 'all'})
        }
        let anyOk = false
        let emptyResult = null
        let lastErr = null
        for (let i = 0; i < variants.length; i++) {
            try {
                let params = {value: value}
                let v = variants[i]
                for (let k in v) params[k] = v[k]
                let json = await this.apiPost('/v4/search/fetch', params)
                if (!Noyacg.isOk(json.status)) {
                    lastErr = `status=${JSON.stringify(json.status)}`
                    continue
                }
                anyOk = true
                let res = this.parseSearchV4(json)
                if (res.comics.length > 0) return res
                emptyResult = res
            } catch (e) {
                lastErr = e
            }
        }
        if (anyOk) return emptyResult
        if (lastErr) console.log(`search failed: ${lastErr}`)
        return null
    }

    coverUrl(id) {
        return `${this.imageBaseUrl}/${id}/m1.webp`
    }

    pageUrl(id, index) {
        return `${this.imageBaseUrl}/${id}/${index}.webp`
    }

    /**
     * 从 api 响应中提取 comic 列表与总数
     */
    parseList(json) {
        let list = Noyacg.pick(json, ['info', 'Info', 'data', 'list'])
        if (!Array.isArray(list)) list = []
        let len = Number(Noyacg.pick(json, ['len', 'Len', 'total', 'count']) || 0)
        if (!len) len = list.length
        let comics = []
        for (let item of list) {
            let c = this.parseComicItem(item)
            if (c.id) comics.push(c)
        }
        let maxPage = Math.max(1, Math.ceil(len / Noyacg.pageSize))
        return {comics: comics, maxPage: maxPage}
    }

    /**
     * 加载排行榜
     * @param name readLeaderboard | favLeaderboard | proportion
     * @param level day | week | moon
     */
    async loadRank(name, level, page) {
        let body = level ? `page=${page}&type=${level}` : `page=${page}`
        let json = await this.request(`/api/${name}`, body)
        return this.parseList(json)
    }

    /**
     * 初始化：恢复已缓存的标签，登录后自动刷新标签并自动签到
     */
    async init() {
        let cached = this.loadData('tags')
        if (cached) {
            try {
                this.applyTags(JSON.parse(cached))
            } catch (e) {
                console.log(`Failed to parse cached tags: ${e}`)
            }
        }
        if (!this.session) return
        try {
            await this.refreshTags(false)
        } catch (e) {
            console.log(`Failed to refresh tags: ${e}`)
        }
        await this.autoSignIn(false)
    }

    // [Optional] account related
    account = {
        login: async (account, pwd) => {
            let res = await this.doLogin(account, pwd)
            try {
                await this.refreshTags(false)
            } catch (e) {
                console.log(`Failed to refresh tags: ${e}`)
            }
            await this.autoSignIn(true)
            return res
        },

        logout: () => {
            this.deleteData('session')
            this.deleteData('username')
            this.deleteData('password')
            Network.deleteCookies(this.baseUrl)
        },

        registerWebsite: "https://noymanga.com"
    }

    // explore page list
    explore = [
        {
            title: "NoyACG",

            type: "multiPartPage",

            load: async (page) => {
                let parts = []

                // 最新上传
                let latest = await this.apiPost('/b1/booklist', {page: 1, sort: 'new', finished: ''})
                parts.push({
                    title: "最新上傳",
                    comics: this.parseList(latest).comics,
                    viewMore: {
                        page: "category",
                        attributes: {
                            category: "最新上傳",
                            param: "",
                        },
                    },
                })

                // 排行榜
                for (let opt of Noyacg.rankingOptions) {
                    let code = opt.split('-')[0]
                    let label = opt.split('-').slice(1).join('-')
                    let mapping = Noyacg.rankMap[code]
                    if (!mapping) continue
                    try {
                        let res = await this.loadRank(mapping[0], mapping[1], 1)
                        parts.push({
                            title: label,
                            comics: res.comics,
                            viewMore: {
                                page: "category",
                                attributes: {
                                    category: label,
                                    param: `${mapping[0]}|${mapping[1]}`,
                                },
                            },
                        })
                    } catch (e) {
                        console.log(`Failed to load ranking ${label}: ${e}`)
                    }
                }

                if (parts.length === 0) {
                    throw 'Failed to load explore page'
                }
                return parts
            },
        }
    ]

    // categories
    category = {
        title: "NoyACG",
        parts: [
            {
                name: "榜單",
                type: "fixed",
                categories: [
                    "最新上傳",
                    "今日閱讀榜",
                    "週閱讀榜",
                    "月閱讀榜",
                    "今日收藏榜",
                    "週收藏榜",
                    "月收藏榜",
                    "高質榜",
                    "收藏推薦",
                ],
                itemType: "category",
                categoryParams: [
                    "",
                    "readLeaderboard|day",
                    "readLeaderboard|week",
                    "readLeaderboard|moon",
                    "favLeaderboard|day",
                    "favLeaderboard|week",
                    "favLeaderboard|moon",
                    "proportion|",
                    "favoritesrecommend|",
                ],
            },
            {
                name: "標籤",
                type: "fixed",
                categories: Noyacg.tags,
                itemType: "category",
                categoryParams: Noyacg.tags,
            },
        ],
        enableRankingPage: true,
    }

    /// category comic loading related
    categoryComics = {
        load: async (category, param, options, page) => {
            let sort = Noyacg.normalizeSort(options)
            let pageNum = Noyacg.pageToApi(page)

            // 无标签 = 全部作品，站点走 booklist 接口（该接口 sort 不能为空）
            if (!param || param === '') {
                return this.parseList(await this.apiPost('/b1/booklist', {
                    page: pageNum, sort: sort || 'new', finished: '',
                }))
            }
            if (param.indexOf('|') !== -1) {
                let values = param.split('|')
                let body = values[1] ? `page=${pageNum}&type=${values[1]}` : `page=${pageNum}`
                return this.parseList(await this.request(`/api/${values[0]}`, body))
            }
            // 标签筛选
            let res = await this.searchQuery(param, 'tag', sort, pageNum)
            if (res) return res
            let json = await this.request(
                '/api/search_v2',
                `info=${encodeURIComponent(param)}&type=tag&sort=${sort || 'bid'}&page=${pageNum}`
            )
            return this.parseList(json)
        },

        optionList: [
            {
                label: "排序",
                options: [
                    "new-最新上傳",
                    "default-默認相關度",
                    "views-最多瀏覽",
                    "favorites-最多收藏",
                    "rating-最高評分",
                ],
            }
        ],

        ranking: {
            options: Noyacg.rankingOptions,
            load: async (option, page) => {
                let mapping = Noyacg.rankMap[String(option).split('-')[0]]
                if (!mapping) {
                    return {comics: [], maxPage: 1}
                }
                return await this.loadRank(mapping[0], mapping[1], Noyacg.pageToApi(page))
            }
        }
    }

    /// search related
    search = {
        /**
         * 站点搜索接口: POST /v4/search/fetch
         * 参数 value(关键词) / mode(范围) / sort / type / page / finished
         * 响应 {status, data:[...], count:N}
         */
        load: async (keyword, options, page) => {
            // options 未传时回退到设置里的默认排序（改设置会重建源，必定生效）
            let raw = (options && options.length > 0 && options[0] !== undefined && options[0] !== null)
                ? String(options[0]) : ''
            let sort = raw === ''
                ? Noyacg.normalizeSort([this.loadSetting('defaultSort')])
                : Noyacg.normalizeSort([raw])
            let pageNum = Noyacg.pageToApi(page)
            let res = await this.searchQuery(keyword, '', sort, pageNum)
            if (res) {
                // 记录交给 App 的结果摘要，便于诊断比对
                this.recordRequest(
                    'RESULT',
                    `page=${pageNum} items=${res.comics.length} maxPage=${res.maxPage}`,
                    res.comics.length > 0 ? `first=${res.comics[0].title}` : 'empty'
                )
                return res
            }
            // 回退旧接口（旧接口用 bid 表示默认排序）
            let json = await this.request(
                '/api/search_v2',
                `info=${encodeURIComponent(keyword)}&type=de&sort=${sort || 'bid'}&page=${pageNum}`
            )
            return this.parseList(json)
        },

        optionList: [
            {
                type: "select",
                label: "排序",
                options: [
                    "new-最新上傳",
                    "default-默認相關度",
                    "views-最多瀏覽",
                    "favorites-最多收藏",
                    "rating-最高評分",
                ],
            }
        ],

        enableTagsSuggestions: false,
    }

    /**
     * 解析章节列表。站点结构:
     *   chapters.categories: [{id, name}] 且 chapters.data: {[catId]: [{id, name, count, sort}]}
     * 兼容 data 为数组、缺少 categories、chapters 直接是数组等变体。
     * @returns {Array<{cat, catName, id, name, count, sort, createdAt}>}
     */
    static parseChapterList(data) {
        let list = []
        let ch = data ? data.chapters : null
        if (!ch) return list

        function push(item, catId, catName) {
            if (!item) return
            list.push({
                cat: String(catId),
                catName: String(catName || ''),
                id: String(Noyacg.pick(item, ['id', 'cid', 'chapter_id']) || ''),
                name: String(Noyacg.pick(item, ['name', 'title', 'chapter_name']) || ''),
                count: Number(Noyacg.pick(item, ['count', 'len', 'page_count', 'pages']) || 0),
                sort: Number(Noyacg.pick(item, ['sort', 'order', 'index']) || 0),
                createdAt: Noyacg.pick(item, ['created_at', 'time', 'create_time'])
                    ? String(Noyacg.pick(item, ['created_at', 'time', 'create_time'])) : null,
            })
        }

        if (Array.isArray(ch)) {
            for (let item of ch) push(item, '0', '')
            return list
        }

        let cats = Array.isArray(ch.categories) ? ch.categories : []
        let map = ch.data || ch.list || ch.chapters || null

        if (cats.length > 0 && map) {
            for (let idx = 0; idx < cats.length; idx++) {
                let cat = cats[idx]
                let items = null
                if (Array.isArray(map)) {
                    items = map[idx]
                } else {
                    items = map[cat.id] !== undefined ? map[cat.id] : map[String(cat.id)]
                }
                if (!Array.isArray(items)) continue
                for (let item of items) push(item, cat.id, cat.name)
            }
        } else if (map && !Array.isArray(map)) {
            for (let k in map) {
                let items = map[k]
                if (!Array.isArray(items)) continue
                for (let item of items) push(item, k, String(k))
            }
        }

        list.sort((a, b) => a.sort - b.sort)
        return list
    }

    /// single comic related
    comic = {
        /**
         * 解析新版详情接口 GET /api/v4/book/{bid}
         * 结构: {status, data: {book: {info: {...}}, chapters: {categories: [{id, name}], data: {[catId]: [{id, name, count, sort}]}}}}
         */
        parseBookV4: (id, json) => {
            let data = json.data || json
            let book = data.book || {}
            let W = book.info || book

            let title = String(Noyacg.pick(W, ['Bookname', 'bookname', 'Name', 'Title']) || '')
            let author = String(Noyacg.pick(W, ['Author', 'author', 'Uploader']) || '')
            let len = Number(Noyacg.pick(W, ['Len', 'len', 'PageCount', 'Pages']) || 0)
            let ptag = Noyacg.pick(W, ['Ptag', 'ptag', 'Tags', 'tags'])
            let views = Noyacg.pick(W, ['Views', 'views', 'ViewCount'])
            let favorites = Noyacg.pick(W, ['Favorites', 'favorites', 'Fav'])
            let uploadTime = Noyacg.pick(W, ['Time', 'time', 'Uptime', 'Addtime'])
            let description = Noyacg.pick(W, ['Description', 'description', 'Intro', 'Des'])
            let status = Noyacg.pick(W, ['Status', 'status'])

            let tagList = []
            if (ptag) tagList = String(ptag).split(' ').filter((e) => e !== '')
            let tags = {}
            if (tagList.length > 0) tags['標籤'] = tagList
            if (author) tags['作者'] = [author]
            if (len) tags['頁數'] = [String(len)]
            if (views) tags['瀏覽'] = [String(views)]
            if (favorites) tags['收藏'] = [String(favorites)]

            let chapterList = Noyacg.parseChapterList(data)

            let chapters = {}
            if (chapterList.length > 0) {
                for (let c of chapterList) {
                    let label = c.name || `第 ${c.id} 話`
                    if (c.catName) label = `${c.catName} · ${label}`
                    chapters[`${c.cat}:${c.id}`] = label
                }
                this.saveData(`chapters_${id}`, JSON.stringify(chapterList))
            } else {
                chapters[id] = "第 1 話"
            }

            return new ComicDetails({
                title: title,
                subtitle: author,
                cover: this.coverUrl(id),
                description: description ? String(description) : null,
                tags: tags,
                chapters: chapters,
                uploader: author,
                uploadTime: uploadTime ? String(uploadTime) : null,
                updateTime: uploadTime ? String(uploadTime) : null,
                likesCount: favorites ? Number(favorites) : null,
                url: `${this.baseUrl}/#/book/${id}`,
            })
        },

        loadInfo: async (id) => {
            // 优先使用新版详情接口（含章节信息：主章 / 番外）
            let v4 = await this.fetchBookV4(id)
            if (v4) {
                return this.comic.parseBookV4(id, v4)
            }

            let json = await this.request('/api/getbookinfo', `bid=${encodeURIComponent(id)}`)
            let data = json
            if (Array.isArray(json)) {
                data = json[0]
            }
            let inner = Noyacg.pick(data, ['info', 'Info', 'data', 'book'])
            if (inner && !Array.isArray(inner)) {
                data = inner
            } else if (Array.isArray(inner) && inner.length > 0) {
                data = inner[0]
            }

            let title = String(Noyacg.pick(data, ['Bookname', 'bookname', 'Title', 'Name']) || '')
            let author = String(Noyacg.pick(data, ['Author', 'author', 'Uploader']) || '')
            let ptag = Noyacg.pick(data, ['Ptag', 'ptag', 'Tags', 'tags'])
            let len = Number(Noyacg.pick(data, ['Len', 'len', 'PageCount', 'Pages', 'PageNum']) || 0)
            let views = Noyacg.pick(data, ['Views', 'views', 'ViewCount'])
            let favorites = Noyacg.pick(data, ['Favorites', 'favorites', 'Fav', 'fav'])
            let uploadTime = Noyacg.pick(data, ['Uptime', 'uptime', 'Addtime', 'CreateTime', 'UpdateTime'])
            let description = Noyacg.pick(data, ['Intro', 'intro', 'Description', 'Des', 'Content'])

            let tags = {}
            let tagList = []
            if (ptag) {
                tagList = String(ptag).split(' ').filter((e) => e !== '')
            }
            if (tagList.length > 0) tags['標籤'] = tagList
            if (author) tags['作者'] = [author]
            if (len) tags['頁數'] = [String(len)]
            if (views) tags['瀏覽'] = [String(views)]
            if (favorites) tags['收藏'] = [String(favorites)]

            let chapters = {}
            chapters[id] = "第 1 話"

            return new ComicDetails({
                title: title,
                subtitle: author,
                cover: this.coverUrl(id),
                description: description ? String(description) : null,
                tags: tags,
                chapters: chapters,
                uploader: author,
                uploadTime: uploadTime ? String(uploadTime) : null,
                updateTime: uploadTime ? String(uploadTime) : null,
                likesCount: favorites ? Number(favorites) : null,
                url: `${this.baseUrl}/#/book/${id}`,
            })
        },

        loadThumbnails: async (id, next) => {
            // 有章节时，用每章第一页作为缩略图
            let cached = this.loadData(`chapters_${id}`)
            let list = null
            if (cached) {
                try {
                    list = JSON.parse(cached)
                } catch (e) {
                    list = null
                }
            }
            if (list && list.length > 0 && !next) {
                let thumbs = []
                for (let c of list) {
                    if (c.id === '0') thumbs.push(this.pageUrl(id, 1))
                    else thumbs.push(`${this.imageBaseUrl}/${id}/${c.id}/1.webp`)
                }
                return {thumbnails: thumbs, next: null}
            }

            if (!next) {
                let json = await this.request('/api/getbookinfo', `bid=${encodeURIComponent(id)}`)
                let data = json
                if (Array.isArray(json)) data = json[0]
                let inner = Noyacg.pick(data, ['info', 'Info', 'data', 'book'])
                if (inner && !Array.isArray(inner)) data = inner
                else if (Array.isArray(inner) && inner.length > 0) data = inner[0]
                this.saveData(`len_${id}`, String(Noyacg.pick(data, ['Len', 'len', 'PageCount', 'Pages']) || 0))
            }
            let len = Number(this.loadData(`len_${id}`) || 0)
            if (!len) return {thumbnails: [], next: null}

            let start = next ? Number(next) : 1
            let thumbnails = []
            let end = Math.min(start + Noyacg.pageSize - 1, len)
            for (let i = start; i <= end; i++) {
                thumbnails.push(this.pageUrl(id, i))
            }
            if (end >= len) {
                return {thumbnails: thumbnails, next: null}
            }
            return {thumbnails: thumbnails, next: String(end + 1)}
        },

        loadEp: async (comicId, epId) => {
            // epId 形如「分类id:章节id」；单本时为 comicId
            let chapterId = '0'
            if (epId && String(epId).indexOf(':') !== -1) {
                chapterId = String(epId).split(':')[1]
            }

            let count = 0
            if (chapterId !== '0') {
                let cached = this.loadData(`chapters_${comicId}`)
                if (cached) {
                    try {
                        let list = JSON.parse(cached)
                        for (let c of list) {
                            if (c.id === chapterId) count = Number(c.count || 0)
                        }
                    } catch (e) {
                        console.log(`Failed to parse chapters cache: ${e}`)
                    }
                }
                if (!count) {
                    let v4 = await this.fetchBookV4(comicId)
                    if (v4) {
                        let list = Noyacg.parseChapterList(v4.data || {})
                        for (let c of list) {
                            if (c.id === chapterId) count = c.count
                        }
                    }
                }
            }

            if (!count) {
                let json = await this.request('/api/getbookinfo', `bid=${encodeURIComponent(comicId)}`)
                let data = json
                if (Array.isArray(json)) data = json[0]
                let inner = Noyacg.pick(data, ['info', 'Info', 'data', 'book'])
                if (inner && !Array.isArray(inner)) data = inner
                else if (Array.isArray(inner) && inner.length > 0) data = inner[0]
                count = Number(Noyacg.pick(data, ['Len', 'len', 'PageCount', 'Pages', 'PageNum']) || 0)
            }

            // 有章节: {bid}/{chapterId}/{page}.webp ；无章节: {bid}/{page}.webp
            let prefix = `${this.imageBaseUrl}/${comicId}`
            if (chapterId !== '0' && chapterId !== '') prefix += `/${chapterId}`
            let images = []
            for (let i = 1; i <= count; i++) {
                images.push(`${prefix}/${i}.webp`)
            }
            if (images.length === 0) {
                throw 'Failed to load images'
            }
            return {images: images}
        },

        /**
         * 评论字段: cid, username, avatar, content, time, reply_num, reply_more
         */
        parseComment: (e) => {
            let time = e.time
            if (typeof time === 'number' && isFinite(time)) {
                let d = new Date(time < 1e12 ? time * 1000 : time)
                let mo = d.getMonth() + 1
                let da = d.getDate()
                let h = d.getHours()
                let mi = d.getMinutes()
                time = `${d.getFullYear()}-${mo < 10 ? '0' + mo : mo}-${da < 10 ? '0' + da : da} ${h < 10 ? '0' + h : h}:${mi < 10 ? '0' + mi : mi}`
            }
            return new Comment({
                userName: String(e.username || ''),
                avatar: e.avatar ? String(e.avatar) : null,
                content: String(e.content || ''),
                time: time ? String(time) : null,
                replyCount: Number(e.reply_num || 0),
                id: (e.cid !== undefined && e.cid !== null) ? String(e.cid) : null,
            })
        },

        loadComments: async (comicId, subId, page, replyTo) => {
            let p = Noyacg.pageToApi(page)
            if (replyTo) {
                let json = await this.apiGet(
                    `/v4/comment/book/${encodeURIComponent(comicId)}/comment/${encodeURIComponent(replyTo)}/replies`,
                    {page: p}
                )
                let data = json.data || {}
                let list = Array.isArray(data.replies) ? data.replies : []
                return {
                    comments: list.map((e) => this.comic.parseComment(e)),
                    maxPage: data.over ? p : p + 1,
                }
            }
            let json = await this.apiGet(
                `/v4/comment/book/${encodeURIComponent(comicId)}/comments`,
                {page: p}
            )
            let data = json.data || {}
            let list = Array.isArray(data.comments) ? data.comments : []
            let total = Number(data.top_count || data.count || 0)
            let maxPage = total > 0 ? Math.max(1, Math.ceil(total / 20)) : (data.over ? p : p + 1)
            return {
                comments: list.map((e) => this.comic.parseComment(e)),
                maxPage: maxPage,
            }
        },

        sendComment: async (comicId, subId, content, replyTo) => {
            let res = await this.apiPost(
                `/v4/comment/book/${encodeURIComponent(comicId)}/comment`,
                {
                    content: content,
                    reply_id: replyTo ? replyTo : 0,
                    platform: 'web',
                    hide_ip: 'false',
                }
            )
            if (!Noyacg.isOk(res.status)) throw 'Failed to send comment'
            return 'ok'
        },

        onImageLoad: (url) => {
            return {
                headers: {
                    'Referer': `${this.baseUrl}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                }
            }
        },

        onThumbnailLoad: (url) => {
            return {
                headers: {
                    'Referer': `${this.baseUrl}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                }
            }
        },

        onClickTag: (namespace, tag) => {
            return {
                page: "search",
                attributes: {
                    keyword: tag,
                },
            }
        },

        idMatch: String.raw`^\d+$`,

        link: {
            domains: [
                'noymanga.com',
                'noy1.top',
            ],
            linkToId: (url) => {
                let m = /[#/]book\/(\d+)/.exec(url)
                if (m) return m[1]
                m = /[#/]read\/(\d+)/.exec(url)
                if (m) return m[1]
                m = /bid[=/](\d+)/.exec(url)
                if (m) return m[1]
                return null
            }
        },
    }

    settings = {
        domain: {
            title: "Domain",
            type: "input",
            validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
            default: 'noymanga.com',
        },
        imageDomain: {
            title: "Image Domain",
            type: "input",
            validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
            default: 'img.noy.asia',
        },
        autoSignIn: {
            title: "Auto Sign In",
            type: "switch",
            default: true,
        },
        signInNow: {
            title: "Sign In Now",
            type: "callback",
            buttonText: "Sign In",
            callback: async () => {
                try {
                    if (!this.session) {
                        UI.showDialog('Not logged in', 'Please login first.', [
                            {text: 'OK', callback: () => {}}
                        ])
                        return
                    }
                    let rec = await this.loadSignInRecord()
                    if (!Noyacg.isOk(rec.status)) {
                        UI.showDialog('Failed', 'Failed to load sign in record.', [
                            {text: 'OK', callback: () => {}}
                        ])
                        return
                    }
                    if (rec.today) {
                        this.saveData('lastSignInDate', this.today)
                        let c = Number(rec.continuous)
                        if (!isFinite(c) || c < 0) c = 0
                        UI.showDialog('Sign In', `Already signed in today.\nContinuous: ${c} day(s)`, [
                            {text: 'OK', callback: () => {}}
                        ])
                        return
                    }
                    let res = await this.signIn()
                    if (!Noyacg.isOk(res.status)) {
                        UI.showDialog('Failed', 'Sign in failed, please try again later.', [
                            {text: 'OK', callback: () => {}}
                        ])
                        return
                    }
                    let c = Number(res.continuous)
                    if (!isFinite(c) || c < 0) c = 1
                    this.saveData('lastSignInDate', this.today)
                    UI.showDialog('Success', `Signed in.\nContinuous: ${c} day(s)`, [
                        {text: 'OK', callback: () => {}}
                    ])
                } catch (e) {
                    UI.showDialog('Failed', String(e), [
                        {text: 'OK', callback: () => {}}
                    ])
                }
            }
        },
        /**
         * 内容类型过滤，与站点「設定 → 內容類型」一致
         * 决定请求头 allow-adult 的取值
         */
        allowAdult: {
            title: "Content Type",
            type: "select",
            options: [
                {value: 'both', text: '顯示所有內容'},
                {value: 'true', text: '僅成人內容'},
                {value: 'false', text: '僅全年齡內容'},
            ],
            default: 'both',
        },
        /**
         * 搜索/分类的默认排序（当搜索页未传排序值时生效）
         */
        defaultSort: {
            title: "Default Sort",
            type: "select",
            options: [
                {value: 'new', text: '最新上傳'},
                {value: 'default', text: '默認相關度'},
                {value: 'views', text: '最多瀏覽'},
                {value: 'favorites', text: '最多收藏'},
                {value: 'rating', text: '最高評分'},
            ],
            default: 'new',
        },
        extraBlockedTags: {
            title: "Extra Blocked Tags",
            type: "input",
            validator: null,
            default: '',
        },
        refreshTags: {
            title: "Refresh Tag List",
            type: "callback",
            buttonText: "Refresh",
            callback: async () => {
                await this.refreshTags(true)
            }
        },
        /**
         * 诊断：输出某本书的详情接口原始结构，用于排查章节识别问题
         */
        diagnoseBook: {
            title: "Diagnose Book",
            type: "callback",
            buttonText: "Diagnose",
            callback: async () => {
                // 注意: showInputDialog 返回 Promise，必须 await
                let input = await UI.showInputDialog('Book ID', (v) => {
                    if (!v || String(v).trim() === '') return 'Please input a book id'
                    return null
                })
                if (!input) return
                let id = String(input).trim()
                let lines = []
                lines.push(`id=${id}  domain=${this.domain}  allowAdult=${this.allowAdult}`)
                lines.push(`session=${this.session ? 'yes(len=' + this.session.length + ')' : 'NONE'}`)

                let p = `/api/v4/book/${encodeURIComponent(id)}`
                lines.push(await this.probe('1 GET v4 +cookie', 'GET', p, true))
                lines.push(await this.probe('2 GET v4 no-cookie', 'GET', p, false))
                lines.push(await this.probe('3 POST v4 form', 'POST', p, true))
                lines.push(await this.probe('4 GET old', 'GET', `/api/getbookinfo?bid=${encodeURIComponent(id)}`, true))
                lines.push(await this.probe('5 POST old', 'POST', '/api/getbookinfo', true, `bid=${encodeURIComponent(id)}`))

                // 若某种方式拿到了数据，顺带解析章节结构
                try {
                    let v4 = await this.fetchBookV4(id)
                    if (!v4) throw 'fetchBookV4 failed'
                    let data = v4.data || {}
                    lines.push(`v4 data keys: ${Object.keys(data).join(',')}`)
                    let ch = data.chapters
                    if (!ch) {
                        lines.push('chapters: MISSING')
                    } else {
                        lines.push(`chapters keys: ${Object.keys(ch).join(',')}`)
                        lines.push(`categories: ${Array.isArray(ch.categories) ? ch.categories.length : typeof ch.categories}`)
                        let map = ch.data
                        if (!map) {
                            lines.push('chapters.data: MISSING')
                        } else if (Array.isArray(map)) {
                            lines.push(`data array len=${map.length}`)
                        } else {
                            for (let k in map) {
                                let arr = map[k]
                                let extra = (Array.isArray(arr) && arr.length > 0) ? ` fields=${Object.keys(arr[0]).join('/')}` : ''
                                lines.push(`  ${k}: ${Array.isArray(arr) ? arr.length + ' items' : typeof arr}${extra}`)
                            }
                        }
                    }
                    lines.push(`parsed chapters: ${Noyacg.parseChapterList(data).length}`)
                } catch (e) {
                    lines.push(`v4 parse error: ${e}`)
                }

                UI.showDialog('Diagnose Book', lines.join('\n'), [
                    {text: 'OK', callback: () => {}}
                ])
            }
        },
        /**
         * 诊断：搜索接口
         */
        diagnoseSearch: {
            title: "Diagnose Search",
            type: "callback",
            buttonText: "Diagnose",
            callback: async () => {
                let kw = await UI.showInputDialog('Keyword', (v) => {
                    if (!v || String(v).trim() === '') return 'Please input a keyword'
                    return null
                })
                if (!kw) return
                let k = encodeURIComponent(String(kw).trim())
                let lines = []
                lines.push(`keyword=${kw}  domain=${this.domain}  v=${this.version}  allowAdult=${this.allowAdult}`)

                // 先回显 App 侧最近的请求（请先在搜索界面搜一次再点诊断，这里就能看到 App 实际发的请求）
                if (this._reqLog && this._reqLog.length > 0) {
                    lines.push('--- App recent requests ---')
                    let from = Math.max(0, this._reqLog.length - 8)
                    for (let i = from; i < this._reqLog.length; i++) {
                        lines.push('  ' + this._reqLog[i])
                    }
                } else {
                    lines.push('--- App recent requests: (none) ---')
                }
                this._reqLog = []

                // 原样回放 App 最近一次搜索请求（最有力的比对）
                if (this._lastSearchBody) {
                    lines.push('--- replay App search request ---')
                    try {
                        let rh = this.headers(true)
        // allow-adult 由 headers() 统一提供
                        rh['Accept'] = 'application/json, text/plain, */*'
                        let rres = await Network.post(`${this.baseUrl}/api/v4/search/fetch`, rh, this._lastSearchBody)
                        let rj = JSON.parse(rres.body)
                        let rlist = Array.isArray(rj.data) ? rj.data : []
                        lines.push(`status=${rres.status} count=${rj.count} items=${rlist.length}`)
                        for (let i = 0; i < Math.min(3, rlist.length); i++) {
                            lines.push(`  ${rlist[i].id} ${rlist[i].name}`)
                        }
                    } catch (e) {
                        lines.push(`replay ERROR: ${e}`)
                    }
                }

                // 接口层对照：重点比较两种排序的差异
                lines.push(await this.probe('1 v4 sort=new(最新)', 'POST', '/api/v4/search/fetch', true, `value=${k}&mode=&sort=new&type=&page=1&finished=`))
                lines.push(await this.probe('2 v4 sort=(相关度)', 'POST', '/api/v4/search/fetch', true, `value=${k}&mode=&sort=&type=&page=1&finished=`))
                lines.push(await this.probe('3 v4 mode=tag', 'POST', '/api/v4/search/fetch', true, `value=${k}&mode=tag&sort=&type=&page=1&finished=`))
                lines.push(await this.probe('4 old search_v2', 'POST', '/api/search_v2', true, `info=${k}&type=de&sort=bid&page=1`))
                lines.push(await this.probe('5 v4 page=2(第二页)', 'POST', '/api/v4/search/fetch', true, `value=${k}&mode=&sort=new&type=&page=2&finished=`))

                // 插件层：走完整链路（与 App 搜索完全相同的入口）
                this._reqLog = []
                lines.push('--- plugin search.load ---')
                try {
                    let res = await this.search.load(String(kw).trim(), ['new'], 0)
                    lines.push(`items=${res.comics.length} maxPage=${res.maxPage} sort=new`)
                    for (let i = 0; i < Math.min(3, res.comics.length); i++) {
                        lines.push(`  ${res.comics[i].id} ${res.comics[i].title}`)
                    }
                } catch (e) {
                    lines.push(`plugin ERROR: ${e}`)
                }
                if (this._reqLog && this._reqLog.length > 0) {
                    lines.push('--- actual requests ---')
                    for (let i = 0; i < Math.min(4, this._reqLog.length); i++) {
                        lines.push('  ' + this._reqLog[i])
                    }
                }

                UI.showDialog('Diagnose Search', lines.join('\n'), [
                    {text: 'OK', callback: () => {}}
                ])
            }
        },
        testConnection: {
            title: "Test Connection",
            type: "callback",
            buttonText: "Test",
            callback: async () => {
                try {
                    let json = await this.request('/api/booklist_v2', `page=1`)
                    let count = Noyacg.pick(json, ['info', 'Info'])
                    let n = Array.isArray(count) ? count.length : 0
                    let session = this.session ? '已登录' : '未登录'
                    UI.showDialog('Success', `Status: OK\nItems: ${n}\nAccount: ${session}`, [
                        {text: 'OK', callback: () => {}}
                    ])
                } catch (e) {
                    UI.showDialog('Failed', String(e), [
                        {text: 'OK', callback: () => {}}
                    ])
                }
            }
        }
    }

    translation = {
        'zh_CN': {
            'Domain': '站点域名',
            'Image Domain': '图片域名',
            'Test Connection': '测试连接',
            'Test': '测试',
            'Auto Sign In': '自动签到',
            'Sign In Now': '立即签到',
            'Sign In': '签到',
            'Refresh Tag List': '刷新标签列表',
            'Content Type': '内容类型',
            'Default Sort': '默认排序',
            'Extra Blocked Tags': '额外屏蔽标签（逗号分隔，仅可增加屏蔽）',
            'Diagnose Book': '诊断书籍章节',
            'Diagnose Search': '诊断搜索接口',
            'Diagnose': '诊断',
            'Book ID': '书籍 ID',
            'Keyword': '关键词',
            'Please input a book id': '请输入书籍 ID',
            'Please input a keyword': '请输入关键词',
            'Refresh': '刷新',
            'Not logged in': '未登录',
            'Please login first.': '请先登录。',
            'Already signed in today.': '今日已签到。',
            'Signed in.': '签到成功。',
            'Failed to load sign in record.': '签到状态加载失败。',
            'Sign in failed, please try again later.': '签到失败，请稍后再试。',
            'Loaded': '已加载',
            'Total': '站点标签总数',
            'Filtered': '已过滤',
            'Success': '成功',
            'Failed': '失败',
            '排序': '排序',
            '最新上傳': '最新上传',
            '默認相關度': '默认相关度',
            '最多瀏覽': '最多浏览',
            '最多收藏': '最多收藏',
            '最高評分': '最高评分',
            '今日閱讀榜': '今日阅读榜',
            '週閱讀榜': '周阅读榜',
            '月閱讀榜': '月阅读榜',
            '今日收藏榜': '今日收藏榜',
            '週收藏榜': '周收藏榜',
            '月收藏榜': '月收藏榜',
            '高質榜': '高质量榜',
            '收藏推薦': '收藏推荐',
            '榜單': '榜单',
            '標籤': '标签',
            '作者': '作者',
            '頁數': '页数',
            '瀏覽': '浏览',
            '收藏': '收藏',
        },
        'zh_TW': {},
        'en': {}
    }
}
