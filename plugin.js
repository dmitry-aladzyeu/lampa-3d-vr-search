/* Lampa 3D / VR v0.2.0 — local, unpublished catalog candidate.
 * Native Lampa API: yumata/lampa-source 7cb2ce0ce320070785ca0be4f43a14f638c1d7d8.
 * One self-contained ES5 file. No keys, settings writes or custom player links. */
(function () {
"use strict";
var Helpers = (function () {
    function token(pattern, text) {
        return new RegExp('(^|[^a-z0-9а-яё])(?:' + pattern + ')(?=$|[^a-z0-9а-яё])', 'i').test(text);
    }

    function classify(title) {
        var text = String(title || '');
        var sep = '[\\s._-]*';
        var vr180 = token('vr' + sep + '180|180' + sep + '(?:°|degrees?)' + sep + '(?:video|vr)|180' + sep + '(?:vr|video)', text);
        var vr360 = token('(?:vr' + sep + '360|360' + sep + 'vr)|360' + sep + '(?:°|degrees?)' + sep + '(?:video|vr)|360' + sep + 'video', text);
        var stereo = token('3d|bd3d|(?:h|half' + sep + '|full' + sep + ')?sbs|side' + sep + 'by' + sep + 'side|(?:h|half' + sep + '|full' + sep + ')(?:ou|tb)|over' + sep + 'under|top' + sep + 'bottom|anaglyph|анаглиф|стереопара', text);
        var labels = [];
        if (vr180) labels.push('Предположительно VR180');
        if (vr360) labels.push('Предположительно 360°');
        if (stereo) labels.push('Стерео/3D по названию');
        return {vr180: vr180, vr360: vr360, stereo: stereo, cinema: stereo && !vr180 && !vr360, label: labels.join(' · ')};
    }

    function btih(uri) {
        var match = /(?:[?&])xt=urn:btih:([a-z0-9]+)(?:&|$)/i.exec(String(uri || '').replace(/%3a/ig, ':'));
        if (!match) return '';
        var hash = match[1].toLowerCase();
        if (/^[0-9a-f]{40}$/.test(hash)) return hash;
        if (!/^[a-z2-7]{32}$/.test(hash)) return '';
        var alphabet = 'abcdefghijklmnopqrstuvwxyz234567', bits = 0, value = 0, hex = '';
        for (var i = 0; i < hash.length; i++) {
            value = (value << 5) | alphabet.indexOf(hash.charAt(i));
            bits += 5;
            if (bits >= 8) {
                bits -= 8;
                var byte = (value >>> bits) & 255;
                hex += ('0' + byte.toString(16)).slice(-2);
            }
        }
        return hex;
    }

    function key(item) {
        var uri = item.MagnetUri || item.Link || item.downloadUrl || '';
        var hash = btih(uri);
        if (hash) return 'btih:' + hash;
        if (uri) return 'uri:' + uri;
        // Parser's `hash` is a title hash, NOT necessarily a torrent info hash.
        return 'fallback:' + JSON.stringify([String(item.Title).toLowerCase().replace(/\s+/g, ' ').trim(), item.Size || item.size || '', item.Tracker || '']);
    }

    function prepare(data, mode) {
        if (!data || !Array.isArray(data.Results)) throw new Error('Invalid Parser response');
        var seen = Object.create(null), list = [], skipped = 0, matched = 0;
        data.Results.forEach(function (item) {
            if (!item || typeof item.Title !== 'string' || !item.Title.trim()) { skipped++; return; }
            var format = classify(item.Title);
            var accept = mode === 'vr180' ? format.vr180 : mode === '360' ? format.vr360 : format.cinema;
            if (!accept) return;
            matched++;
            var id = key(item);
            if (!seen[id]) { seen[id] = true; list.push({element: item, format: format}); }
        });
        return {items: list, total: data.Results.length, matched: matched, duplicates: matched - list.length, skipped: skipped};
    }

    function escapeHTML(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
        });
    }


return {classify:classify,key:key,btih:btih,prepare:prepare,escapeHTML:escapeHTML};
}());
var Core = (function () {

    'use strict';
    var PROFILES = {
        all: {format: '3d', query: '3D'},
        films: {format: '3d', query: '3D'},
        animation: {format: '3d', query: '3D'},
        unknown: {format: '3d', query: '3D'},
        vr180: {format: 'vr180', query: 'VR180'},
        vr360: {format: '360', query: 'VR360'}
    };
    function normal(text) {
        return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function titleInfo(title) {
        var text = String(title || '').trim();
        var collection = /(?:\b(?:collection|season|s\d{1,2}e?\d*)\b|коллекци|трилоги|сезон|\((?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\))/i.test(text);
        var matches = [], regex = /(^|[^0-9])((?:19|20)\d{2})(?=$|[^0-9])/g, match;
        while ((match = regex.exec(text))) {
            if (Number(match[2]) <= new Date().getFullYear() + 1) matches.push({year: match[2], at: match.index + match[1].length});
        }
        // Prefer a bracketed release year. Otherwise use the last plausible year
        // before technical tags, leaving numeric film titles such as 1917 intact.
        var bracket = /[\[(]((?:19|20)\d{2})[\])]/.exec(text);
        if (bracket && Number(bracket[1]) > new Date().getFullYear() + 1) bracket = null;
        var chosen = bracket ? {year: bracket[1], at: bracket.index} : matches[matches.length - 1];
        var tech = /(^|[\s._\[(-])(?:3d|bd3d|h?sbs|half[ ._-]*sbs|full[ ._-]*sbs|\d{3,4}p|bluray|blu[ ._-]*ray|bdrip|web[ ._-]*dl|webrip|dvdrip|x26[45]|h26[45])(?=$|[\s._\])-])/i.exec(text);
        if (!bracket && chosen && tech && chosen.at > tech.index) chosen = null;
        if (chosen && chosen.at === 0) chosen = null;
        var clean = chosen ? text.slice(0, chosen.at) : text.slice(0, tech ? tech.index : text.length);
        clean = clean.replace(/[\s._\[(\-–]+$/, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
        var aliases = clean.split(/\s*\/\s*|\s+\|\s+/).filter(function (s) { return normal(s); });
        var year = chosen && !collection ? chosen.year : '';
        return {title: aliases[0] || text, aliases: aliases, year: year, safeToGroup: Boolean(year && aliases.length && !collection)};
    }
    function accepted(format, mode) {
        return mode === 'vr180' ? format.vr180 : mode === '360' ? format.vr360 : format.cinema;
    }
    function snapshot(data, mode, helpers, limit) {
        if (!data || !Array.isArray(data.Results)) throw new Error('Invalid Parser response');
        limit = limit || 300;
        var seen = Object.create(null), map = Object.create(null), groups = [], unclassified = [], records = [], duplicates = 0, invalidRecords = 0;
        data.Results.slice(0, limit).forEach(function (release) {
            if (!release || typeof release.Title !== 'string' || !release.Title.trim()) { invalidRecords++; return; }
            var format = helpers.classify(release.Title);
            var releaseKey = helpers.key(release);
            if (seen[releaseKey]) { duplicates++; return; }
            seen[releaseKey] = true;
            records.push(release);
            if (!accepted(format, mode)) {
                unclassified.push({key: 'unclassified:' + releaseKey, title: release.Title, aliases: [], year: '', format: 'unclassified', releases: [release], labels: ['Формат не подтверждён для выбранного раздела' + (format.label ? ' · ' + format.label : '')], movie: null, match: 'unidentified', kind: 'unknown', eligible: false});
                return;
            }
            var info = titleInfo(release.Title);
            var movieLike = mode === '3d' && info.safeToGroup;
            var groupKey = movieLike ? 'title:' + normal(info.title) + ':' + info.year : 'release:' + releaseKey;
            var group = map[groupKey];
            if (!group) {
                group = {key: groupKey, title: info.title, aliases: info.aliases, year: info.year, format: mode, releases: [], labels: [], movie: null, match: 'unidentified', kind: 'unknown', eligible: movieLike};
                map[groupKey] = group;
                groups.push(group);
            }
            group.releases.push(release);
            if (group.labels.indexOf(format.label) < 0) group.labels.push(format.label);
            info.aliases.forEach(function (alias) { if (group.aliases.indexOf(alias) < 0) group.aliases.push(alias); });
        });
        return {groups: groups, unclassified: unclassified, records: records, invalidRecords: invalidRecords, sourceTotal: data.Results.length, scanned: Math.min(limit, data.Results.length), scanLimited: data.Results.length > limit, duplicates: duplicates, completeness: 'unknown', evidence: 'parser_results', metadataAttempted: 0, queries: []};
    }
    function candidate(group, results) {
        var matches = [], seen = Object.create(null);
        if (!group.eligible || !Array.isArray(results)) return {status: 'unidentified', movie: null};
        results.forEach(function (item) {
            if (!item || !item.id || item.media_type && item.media_type !== 'movie') return;
            var year = String(item.release_date || '').slice(0, 4);
            var exact = group.aliases.some(function (alias) { return normal(alias) === normal(item.title) || normal(alias) === normal(item.original_title); });
            if (year === group.year && exact && !seen[item.id]) { seen[item.id] = true; matches.push(item); }
        });
        return {status: matches.length === 1 ? 'strict_title_year' : matches.length > 1 ? 'ambiguous' : 'unidentified', movie: matches.length === 1 ? matches[0] : null};
    }
    function applyMetadata(group, results) {
        var match = candidate(group, results);
        group.match = match.status;
        group.movie = match.movie;
        var genres = group.movie && group.movie.genre_ids;
        group.kind = Array.isArray(genres) && genres.length ? genres.indexOf(16) >= 0 ? 'animation' : 'film' : 'unknown';
        return group;
    }
    function mergeIdentified(groups) {
        var map = Object.create(null), merged = [];
        groups.forEach(function (group) {
            var key = group.movie && group.match === 'strict_title_year' ? 'tmdb:movie:' + group.movie.id : group.key;
            if (!map[key]) { map[key] = group; merged.push(group); }
            else {
                var previous = map[key];
                group.releases.forEach(function (release) { if (previous.releases.indexOf(release) < 0) previous.releases.push(release); });
                group.labels.forEach(function (label) { if (previous.labels.indexOf(label) < 0) previous.labels.push(label); });
            }
        });
        return merged;
    }
    function section(groups, name) {
        return groups.filter(function (group) {
            if (name === 'films') return group.format === '3d' && group.kind === 'film';
            if (name === 'animation') return group.format === '3d' && group.kind === 'animation';
            if (name === 'unknown') return group.format === '3d' && group.kind === 'unknown';
            if (name === 'vr180') return group.format === 'vr180';
            if (name === 'vr360') return group.format === '360';
            return group.format === '3d';
        });
    }
    function page(groups, pageNumber, perPage) {
        perPage = perPage || 20;
        pageNumber = Math.max(1, Number(pageNumber) || 1);
        return {page: pageNumber, total_pages: Math.max(1, Math.ceil(groups.length / perPage)), total_results: groups.length, results: groups.slice((pageNumber - 1) * perPage, pageNumber * perPage)};
    }
    function mergeSnapshots(base, next, format, helpers) {
        if (!base) return next;
        var records = (base.records || []).concat(next.records || []);
        var merged = snapshot({Results: records}, format, helpers, records.length || 1);
        // Preserve metadata only when it still satisfies the strict identity test.
        merged.groups.forEach(function (group) {
            base.groups.concat(next.groups).some(function (old) {
                if (old.movie && candidate(group, [old.movie]).movie) { applyMetadata(group, [old.movie]); group.metadataChecked = true; return true; }
                if (old.key === group.key) { group.match = old.match; group.metadataChecked = old.metadataChecked; }
                return false;
            });
        });
        merged.groups = mergeIdentified(merged.groups);
        merged.queries = (base.queries || []).concat(next.queries || []);
        merged.sourceTotal = base.sourceTotal + next.sourceTotal;
        merged.scanned = base.scanned + next.scanned;
        merged.scanLimited = base.scanLimited || next.scanLimited;
        merged.metadataAttempted = base.metadataAttempted + next.metadataAttempted;
        merged.invalidRecords = base.invalidRecords + next.invalidRecords;
        return merged;
    }
    return {profiles: PROFILES, normal: normal, titleInfo: titleInfo, snapshot: snapshot, candidate: candidate, applyMetadata: applyMetadata, mergeIdentified: mergeIdentified, mergeSnapshots: mergeSnapshots, section: section, page: page};

}());
var Adapter = (function (Core) {
    function cardData(L, group) {
        var data = {}, movie = group.movie;
        if (movie) Object.keys(movie).forEach(function (key) { data[key] = movie[key]; });
        data.title = movie && movie.title || group.title;
        data.release_date = movie && movie.release_date || (group.year ? group.year + '-01-01' : '');
        data.source = movie ? 'tmdb' : '';
        data.catalogGroup = group;
        data.params = {createInstance: function (element) {
            return L.Maker.make('Card', element, function (helper) { return helper.only('Card', 'Style', 'Release', 'Callback'); });
        }};
        return data;
    }
    function category(L, object, data, sectionName, hooks) {
        hooks = hooks || {};
        if (!L.Maker || typeof L.Maker.make !== 'function') throw new Error('Native Maker API unavailable');
        object.page = object.page || 1;
        var comp = L.Maker.make('Category', object);
        var groups = Core.section(data.groups, sectionName);
        function localPage() {
            var result = Core.page(groups, object.page);
            result.results = result.results.map(function (group) { return cardData(L, group); });
            return result;
        }
        comp.use({
            onCreate: function () { this.build(localPage()); },
            onNext: function (resolve) { resolve(localPage()); },
            onInstance: function (card, element) {
                card.use({onEnter: function () { if (hooks.openGroup) hooks.openGroup(element.catalogGroup); }});
                card.use({onCreate: function () {
                    var badge = L.Template.elem('div', {class: 'card__quality', text: 'Найдено релизов: ' + element.catalogGroup.releases.length});
                    this.html.find('.card__view').append(badge);
                }});
            },
            onRight: function () { if (hooks.menu) hooks.menu(); },
            onDestroy: function () { if (hooks.destroy) hooks.destroy(); }
        });
        return comp;
    }
    function openRelease(L, group, release, back) {
        if (group.releases.indexOf(release) < 0) throw new Error('Release is not in this parser snapshot');
        var movie = group.movie || {title: group.title};
        L.Torrent.back(back);
        L.Torrent.start(release, movie);
    }
    return {category: category, cardData: cardData, openRelease: openRelease};

}(Core));
var Loader = (function (Core) {

    'use strict';
    var schedulers = [];
    function schedulerFor(L) {
        for (var i = 0; i < schedulers.length; i++) if (schedulers[i].L === L) return schedulers[i];
        var scheduler = {L: L, active: 0, queue: []};
        schedulers.push(scheduler);
        return scheduler;
    }
    function enrich(L, snapshot, callbacks, options) {
        options = options || {};
        callbacks = callbacks || {};
        var scheduler = schedulerFor(L), stopped = false;
        var source = L.Api && L.Api.sources && L.Api.sources.tmdb;
        var max = Math.min(20, Math.max(0, options.maxMetadata === undefined ? 20 : options.maxMetadata));
        var groups = source && typeof source.get === 'function' ? snapshot.groups.filter(function (g) { return g.eligible && !g.metadataChecked; }).slice(0, max) : [];
        var remaining = groups.length;
        snapshot.metadataAttempted += groups.length;
        var setTimer = options.setTimeout || setTimeout, clearTimer = options.clearTimeout || clearTimeout;
        function finish() {
            if (stopped) return;
            snapshot.groups = Core.mergeIdentified(snapshot.groups);
            if (callbacks.complete) callbacks.complete(snapshot);
        }
        function pump() {
            while (scheduler.active < 2 && scheduler.queue.length) {
                var task = scheduler.queue.shift();
                if (!task.stopped()) task.run();
            }
        }
        groups.forEach(function (group) {
            scheduler.queue.push({stopped: function () { return stopped; }, run: function () {
                scheduler.active++;
                var settled = false;
                var timer = setTimer(function () { done(null); }, 12000);
                function done(data) {
                    if (settled) return;
                    settled = true;
                    clearTimer(timer);
                    scheduler.active--;
                    remaining--;
                    if (!stopped) {
                        group.metadataChecked = true;
                        if (data && Array.isArray(data.results)) Core.applyMetadata(group, data.results);
                        else group.match = 'metadata_unavailable';
                        if (callbacks.progress) callbacks.progress(snapshot, group);
                        if (!remaining) finish();
                    }
                    pump();
                }
                try {
                    source.get('search/movie', {query: encodeURIComponent(group.title), page: 1, filter: {year: group.year, include_adult: 'false'}}, done, function () { done(null); }, {life: 60 * 24});
                } catch (e) { done(null); }
            }});
        });
        if (!groups.length) finish();
        else pump();
        return {cancel: function () {
            stopped = true;
            // Started requests retain their scheduler slots until callback/timeout.
            // Thus rapid cancel/retry cannot launch an unbounded TMDB burst.
            scheduler.queue = scheduler.queue.filter(function (task) { return !task.stopped(); });
        }};
    }
    function load(L, format, query, helpers, callbacks, options) {
        options = options || {};
        callbacks = callbacks || {};
        var stopped = false, parserPending = false, settled = false, timer, metadata;
        var setTimer = options.setTimeout || setTimeout, clearTimer = options.clearTimeout || clearTimeout;
        function parserFinished() {
            parserPending = false;
            clearTimer(timer);
            if (callbacks.parserFinished) callbacks.parserFinished();
        }
        function abortParser() {
            if (parserPending && options.ownsParser && L.Parser && typeof L.Parser.clear === 'function') L.Parser.clear();
        }
        function fail(text) {
            if (stopped || settled) return;
            settled = true;
            abortParser();
            parserFinished();
            if (callbacks.error) callbacks.error(text);
        }
        if (!L.Parser || typeof L.Parser.get !== 'function') fail('Lampa.Parser недоступен в этой сборке.');
        else {
            parserPending = true;
            timer = setTimer(function () { fail('Parser не завершил запрос за 60 секунд. Выдача неизвестна. Повтор — вручную.'); }, 60000);
            try {
                L.Parser.get({search: query, from_search: true, other: true}, function (data) {
                    if (stopped || settled) return;
                    settled = true;
                    parserFinished();
                    var snapshot;
                    try { snapshot = Core.snapshot(data, format, helpers, 300); }
                    catch (e) { if (callbacks.error) callbacks.error('Некорректный ответ Parser. Выдача неизвестна.'); return; }
                    snapshot.queries = [query];
                    if (callbacks.preview) callbacks.preview(snapshot);
                    if (stopped) return;
                    metadata = enrich(L, snapshot, callbacks, options);
                }, function () {
                    fail('Parser сообщил ошибку. Возможен отказ доступа, включая 403. Выдача неизвестна. Повтор — вручную.');
                });
            } catch (e) { fail('Не удалось запустить Parser. Выдача неизвестна.'); }
        }
        return {cancel: function () {
            if (stopped) return;
            stopped = true;
            settled = true;
            abortParser();
            if (parserPending) parserFinished();
            clearTimer(timer);
            if (metadata) metadata.cancel();
        }};
    }
    return {load: load, enrich: enrich};

}(Core));
/* Runtime appended to the single-file v2 bundle by build.js. */
(function (root) {
    'use strict';
    if (typeof module !== 'undefined' && module.exports) module.exports = {Core: Core, Loader: Loader, Adapter: Adapter, Helpers: Helpers};
    if (!root || !root.Lampa || !root.jQuery || root.__lampa_3d_vr_catalog_v2) return;
    var L = root.Lampa, $ = root.jQuery, registered = false, parserOwner = null;
    var cache = Object.create(null), cacheOrder = [];
    var NAME = 'lampa_3d_vr_catalog';
    var SECTIONS = [
        {id: 'all', title: 'Все результаты 3D-поиска'},
        {id: 'films', title: 'Фильмы 3D'},
        {id: 'animation', title: 'Мультфильмы 3D'},
        {id: 'unknown', title: 'Неопознанные / без метки'},
        {id: 'vr180', title: 'VR180'},
        {id: 'vr360', title: '360°'}
    ];
    root.__lampa_3d_vr_catalog_v2 = true;
    function saveCache(key, data) {
        cache[key] = data;
        var old = cacheOrder.indexOf(key);
        if (old >= 0) cacheOrder.splice(old, 1);
        cacheOrder.push(key);
        while (cacheOrder.length > 10) delete cache[cacheOrder.shift()];
    }
    function Screen(object) {
        var self = this, scroll = new L.Scroll({mask: true, over: true});
        var html = $('<div class="lampa-3d-vr-catalog"></div>');
        var head = $('<div style="padding:1em"></div>');
        var toolbar = $('<div style="display:flex;flex-wrap:wrap;gap:.5em"></div>');
        var status = $('<div style="padding:.6em 0" role="status"></div>');
        var notice = $('<div style="font-size:.8em;opacity:.8;padding:.3em 0"></div>').text('Подборка из ответов Parser, не полный каталог. Метки формата предположительны; SBS не доказывает VR.');
        var pager = $('<div style="display:flex;gap:.5em;align-items:center"></div>');
        var pageLabel = $('<span></span>');
        var grid = $('<div class="mapping--grid cols--6"></div>');
        var cards = [], bindings = [], buttons = Object.create(null);
        var section = object.section || 'all', format = section === 'vr180' ? 'vr180' : section === 'vr360' ? '360' : '3d';
        var query = String(object.search || '').trim(), searching = Boolean(query), activeQuery = query;
        var data = null, pageNumber = 1, initialized = false, destroyed = false, active = false;
        var busy = false, serial = 0, handle = null, lastKey = '', message = '', failure = '', cancelled = false, renderWarning = '';
        function button(id, title, call, parent) {
            var item = $('<div class="simple-button selector"></div>').text(title);
            item.on('hover:enter', function () { if (!destroyed) call(); });
            item.on('hover:focus hover:touch', function () { lastKey = 'button:' + id; });
            buttons[id] = item;
            (parent || toolbar).append(item);
            return item;
        }
        function sectionTitle() {
            for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === section) return SECTIONS[i].title;
            return SECTIONS[0].title;
        }
        function defaultQuery() { return format === 'vr180' ? 'VR180' : format === '360' ? 'VR360' : '3D'; }
        function cacheKey() { return format + (searching ? '|search|' + activeQuery : '|browse'); }
        function ownActivity() { return typeof L.Activity.own !== 'function' || L.Activity.own(self); }
        function restore() { if (!destroyed && ownActivity()) self.start(); }
        function focusIfContent() { if (active && !destroyed && L.Controller.enabled().name === 'content') self.start(); }
        function visibleGroups() {
            if (!data) return [];
            if (section === 'unknown') return (format === '3d' ? Core.section(data.groups, 'unknown') : []).concat(data.unclassified || []);
            if (section === 'all') return data.groups.concat(data.unclassified || []);
            return Core.section(data.groups, section);
        }
        function summary() {
            if (!data) return '';
            var releaseCount = 0, matched = 0, checked = 0, remaining = 0;
            data.groups.forEach(function (g) { releaseCount += g.releases.length; if (g.movie) matched++; if (g.metadataChecked) checked++; if (g.eligible && !g.metadataChecked) remaining++; });
            var text = 'Карточек с меткой: ' + data.groups.length + ', релизов: ' + releaseCount + '. Без подтверждённой метки: ' + (data.unclassified || []).length + '. TMDB: ' + matched + ' совпадений; проверено групп: ' + checked + '.';
            text += ' Запросы: ' + (data.queries || []).join(', ') + '. Страницы — только по полученным данным.';
            text += ' Записей в ответах: ' + data.sourceTotal + ' (включая возможные повторы).';
            if (data.invalidRecords) text += ' Некорректных записей: ' + data.invalidRecords + '.';
            if (data.scanLimited) text += ' Частичная выборка: обработано не более 300 записей каждого ответа.';
            if (remaining) text += ' Ещё без проверки постера: ' + remaining + '.';
            if (section === 'films' || section === 'animation') text += ' Жанр известен лишь для сопоставленных карточек; неопознанные сохранены отдельно.';
            return text;
        }
        function controls() {
            buttons.section.text('Раздел: ' + sectionTitle());
            buttons.search.text(query.trim() ? 'Запрос: ' + query.trim() : 'Поиск по названию');
            buttons.submit.toggleClass('hide', !query.trim());
            buttons.browse.toggleClass('hide', !searching);
            buttons.cancel.toggleClass('hide', !busy);
            buttons.more.toggleClass('hide', busy || !data || !data.groups.some(function (g) { return g.eligible && !g.metadataChecked; }));
            buttons.seeds.toggleClass('hide', searching);
            var total = Math.max(1, Math.ceil(visibleGroups().length / 20));
            buttons.prev.toggleClass('hide', pageNumber <= 1);
            buttons.next.toggleClass('hide', pageNumber >= total);
            pageLabel.text('Страница ' + pageNumber + ' / ' + total + ' · полученные карточки');
            status.text([failure || message, renderWarning, summary()].filter(Boolean).join(' '));
        }
        function clearCards() { cards.forEach(function (card) { card.destroy(); }); cards = []; bindings = []; grid.empty(); }
        function updateCard(binding) {
            var group = binding.group, movie = group.movie;
            if (movie && group.match === 'strict_title_year') {
                binding.card.data.title = movie.title || group.title;
                binding.card.data.poster_path = typeof movie.poster_path === 'string' && movie.poster_path.charAt(0) === '/' ? movie.poster_path : '';
                binding.card.render().find('.card__title').text(binding.card.data.title);
                if (binding.card.visible) binding.card.visible();
            }
            binding.hint.text(group.labels.join(' · ') + ' · ' + group.releases.length + ' релиз(ов)' + (movie ? ' · TMDB: название/год' : ' · без сопоставленного постера'));
        }
        function paintGroup(group) {
            bindings.forEach(function (binding) {
                if (binding.group.key === group.key || group.movie && Core.candidate(binding.group, [group.movie]).movie) {
                    binding.group.movie = group.movie;
                    binding.group.kind = group.kind;
                    binding.group.match = group.match;
                    binding.group.metadataChecked = group.metadataChecked;
                    updateCard(binding);
                }
            });
        }
        function renderPage(resetScroll) {
            var groups = visibleGroups();
            pageNumber = Math.max(1, Math.min(pageNumber, Math.ceil(groups.length / 20) || 1));
            var selected = lastKey;
            var selectedRelease = '';
            bindings.some(function (binding) { if ('group:' + binding.group.key === selected && binding.group.releases.length) { selectedRelease = Helpers.key(binding.group.releases[0]); return true; } return false; });
            if (selectedRelease && !groups.some(function (g) { return 'group:' + g.key === selected; })) {
                groups.some(function (g) { if (g.releases.some(function (r) { return Helpers.key(r) === selectedRelease; })) { selected = 'group:' + g.key; return true; } return false; });
            }
            clearCards();
            renderWarning = '';
            if (resetScroll) scroll.reset();
            if (!groups.length) {
                var empty = busy && data ? 'Получены релизы; сопоставляем постеры и жанры…' : failure ? 'Не удалось получить новую выдачу. Можно повторить вручную.' : data && data.records.length ? 'В этом разделе пока нет подтверждённых карточек. Проверьте «Все результаты» и «Неопознанные».' : data && data.invalidRecords ? 'Ответ получен, но записи некорректны. Это не подтверждает отсутствие релизов.' : data ? 'Источник успешно ответил, но ничего не вернул для этого запроса. Полнота каталога неизвестна.' : cancelled ? 'Загрузка отменена. Можно повторить вручную.' : 'Загружаем подборку…';
                grid.append($('<div style="grid-column:1/-1;padding:2em"></div>').text(empty));
            }
            Core.page(groups, pageNumber).results.forEach(function (group) {
                var cardData = Adapter.cardData(L, group);
                var card;
                var binding = {card: null, group: group, hint: $('<div style="font-size:.72em;opacity:.8;padding:.25em;overflow-wrap:anywhere"></div>')};
                function cardEvents() { return {onEnter: function () { openGroup(binding.group); }, onFocus: function () { lastKey = 'group:' + binding.group.key; scroll.update(card.render(), true); }, onTouch: function () { lastKey = 'group:' + binding.group.key; }}; }
                try {
                    card = cardData.params.createInstance(cardData);
                    card.use(cardEvents());
                    card.create();
                    card.render().append(binding.hint);
                } catch (e) {
                    try { if (card) card.destroy(); } catch (ignored) {}
                    var plain = $('<div class="simple-button selector" style="display:block;padding:1em"></div>');
                    plain.append($('<div class="card__title"></div>').text(cardData.title));
                    card = {data: cardData, render: function () { return plain; }, create: function () {}, destroy: function () { plain.remove(); }, use: function (hooks) { plain.on('hover:enter', hooks.onEnter); plain.on('hover:focus', hooks.onFocus); }};
                    card.use(cardEvents()); plain.append(binding.hint);
                    renderWarning = 'Штатные карточки недоступны в этой сборке: показаны упрощённые элементы с сохранёнными релизами.';
                }
                binding.card = card;
                bindings.push(binding); cards.push(card);
                grid.append(card.render());
                // Core strict-match is the only route assigning a poster.
                updateCard(binding);
            });
            lastKey = selected || (bindings.length ? 'group:' + bindings[0].group.key : '');
            controls();
            if (L.Layer && L.Layer.update) L.Layer.update(scroll.render(true));
            focusIfContent();
        }
        function cancel(text) {
            serial++;
            if (handle) handle.cancel();
            handle = null;
            if (parserOwner === self) parserOwner = null;
            var wasBusy = busy;
            busy = false;
            if (wasBusy) { cancelled = true; message = text || 'Загрузка отменена. Уже полученные карточки сохранены; поздние ответы игнорируются.'; }
            controls();
        }
        function begin(queryValue, append) {
            cancel();
            if (!L.Maker || typeof L.Maker.make !== 'function') { failure = 'Эта сборка Lampa не предоставляет Maker для штатных карточек.'; controls(); return; }
            if (parserOwner && parserOwner !== self) { failure = 'Другой экран 3D / VR выполняет запрос. Отмените его на том экране.'; controls(); return; }
            var id = serial, key = cacheKey(), base = append ? data : null;
            if (append && base && base.queries.indexOf(queryValue) >= 0) { message = 'Эта метка уже загружена в подборку.'; failure = ''; controls(); return; }
            if (append && base && base.queries.length >= 4) { message = 'В подборке уже четыре запроса. Для новой выборки нажмите «Обновить».'; controls(); return; }
            busy = true; cancelled = false; failure = '';
            message = 'Поиск релизов через настроенный Parser: ' + queryValue + '…';
            parserOwner = self;
            controls();
            if (!data) renderPage(false);
            var callbacks = {
                parserFinished: function () { if (parserOwner === self) parserOwner = null; },
                preview: function (snapshot) {
                    if (destroyed || id !== serial) return;
                    if (base) snapshot.groups.forEach(function (g) { base.groups.some(function (old) {
                        if (old.movie && Core.candidate(g, [old.movie]).movie) { Core.applyMetadata(g, [old.movie]); g.metadataChecked = true; return true; }
                        if (g.key === old.key && old.metadataChecked) { g.metadataChecked = true; g.match = old.match; return true; }
                        return false;
                    }); });
                    data = base ? Core.mergeSnapshots(base, snapshot, format, Helpers) : snapshot;
                    saveCache(key, data);
                    message = 'Релизы получены. Добавляем постеры: до 20 групп, не более двух запросов одновременно.';
                    pageNumber = 1; renderPage(true);
                },
                progress: function (snapshot, group) {
                    if (destroyed || id !== serial) return;
                    paintGroup(group); controls();
                },
                complete: function (snapshot) {
                    if (destroyed || id !== serial) return;
                    data = base ? Core.mergeSnapshots(base, snapshot, format, Helpers) : snapshot;
                    saveCache(key, data); busy = false; handle = null;
                    message = 'Подборка загружена. Релизы найдены Parser; воспроизведение и реальный формат видео не проверены.';
                    renderPage(false);
                },
                error: function (text) {
                    if (destroyed || id !== serial) return;
                    busy = false; handle = null; failure = text + (data ? ' На экране сохранена предыдущая подборка.' : '');
                    renderPage(false);
                }
            };
            var job = Loader.load(L, format, queryValue, Helpers, callbacks, {ownsParser: true});
            if (id === serial && busy) handle = job;
        }
        function enterSection(id) {
            var nextFormat = id === 'unknown' ? format : id === 'vr180' ? 'vr180' : id === 'vr360' ? '360' : '3d';
            section = id; pageNumber = 1; lastKey = '';
            if (nextFormat === format && (busy || data)) { renderPage(true); return; }
            cancel(); failure = ''; format = nextFormat;
            data = cache[cacheKey()] || null;
            if (data) { message = 'Сохранённая в памяти подборка. Нового запроса источнику не было.'; renderPage(true); }
            else begin(searching ? activeQuery : defaultQuery(), false);
        }
        function sections() {
            L.Select.show({title: '3D / VR — разделы', items: SECTIONS.map(function (s) { return {id: s.id, title: s.title, selected: s.id === section}; }), onSelect: function (s) { if (destroyed) return; enterSection(s.id); restore(); }, onBack: restore});
        }
        function seeds() {
            var names = format === '3d' ? ['3D', 'SBS', 'HSBS', 'стереопара'] : format === 'vr180' ? ['VR180', '180 video'] : ['VR360', '360 video'];
            L.Select.show({title: 'Один дополнительный запрос по метке', items: names.map(function (name) { return {title: name, query: name, subtitle: data && data.queries.indexOf(name) >= 0 ? 'Уже загружено' : 'По запросу будет получена ограниченная выборка'}; }), onSelect: function (s) { if (!destroyed) { begin(s.query, true); restore(); } }, onBack: restore});
        }
        function metadata() {
            if (!data || busy) return;
            var source = L.Api && L.Api.sources && L.Api.sources.tmdb;
            if (!source || typeof source.get !== 'function') { message = 'Штатный TMDB API недоступен; найденные релизы остаются без постеров.'; controls(); return; }
            cancel(); var id = serial, snapshot = data, key = cacheKey(); busy = true; failure = ''; message = 'Добавляем постеры для следующих 20 подходящих групп…'; controls();
            var job = Loader.enrich(L, snapshot, {progress: function (s, g) { if (!destroyed && id === serial) { paintGroup(g); controls(); } }, complete: function (s) { if (destroyed || id !== serial) return; data = s; saveCache(key, s); busy = false; handle = null; message = 'Порция метаданных обработана. Несопоставленные релизы сохранены.'; renderPage(false); }});
            if (id === serial && busy) handle = job;
        }
        function openGroup(group) {
            if (destroyed) return;
            var items = group.releases.map(function (release) {
                var size = release.size || (L.Utils && L.Utils.bytesToSize && Number(release.Size) > 0 ? L.Utils.bytesToSize(Number(release.Size)) : '');
                var template = L.Template.get('torrent', {title: Helpers.escapeHTML(release.Title), date: '', tracker: Helpers.escapeHTML(release.Tracker), bitrate: '', size: Helpers.escapeHTML(size), seeds: Helpers.escapeHTML(release.Seeders), grabs: Helpers.escapeHTML(release.Peers)});
                template.find('.bitrate').remove();
                template.append($('<div style="font-size:.8em;opacity:.8"></div>').text(group.labels.join(' · ') + ' — формат видео не проверен'));
                return {title: release.Title, html: template, release: release};
            });
            if (group.movie) items.push({title: 'Описание в TMDB', description: true});
            L.Select.show({title: (group.movie && group.movie.title || group.title) + ' · найденные релизы', items: items, onBack: restore, onSelect: function (item) {
                if (destroyed) return;
                if (item.description) { L.Activity.push({component: 'full', id: group.movie.id, method: 'movie', source: 'tmdb', card: group.movie, title: group.movie.title || group.title}); return; }
                if (!L.Torrent || typeof L.Torrent.start !== 'function') { failure = 'Штатное открытие торрента недоступно.'; controls(); restore(); return; }
                Adapter.openRelease(L, group, item.release, restore);
            }});
        }
        button('section', 'Разделы', sections);
        button('refresh', 'Обновить', function () { begin(searching ? activeQuery : defaultQuery(), false); });
        button('seeds', 'Другие метки', seeds);
        button('more', 'Ещё постеры', metadata);
        button('search', 'Поиск по названию', function () {
            cancel();
            L.Input.edit({title: 'Дополнительный поиск по названию', value: query, free: true, nosave: true}, function (value) { if (!destroyed) { query = String(value || '').trim(); message = 'Черновик. Поиск запускается только кнопкой «Искать».'; controls(); restore(); } });
        });
        button('submit', 'Искать', function () { if (!query.trim()) return; searching = true; activeQuery = query.trim(); data = null; pageNumber = 1; begin(activeQuery, false); });
        button('browse', 'К подборке', function () { searching = false; data = cache[cacheKey()] || null; if (data) { cancel(); failure = ''; message = 'Подборка сохранена в памяти.'; renderPage(true); } else begin(defaultQuery(), false); });
        button('cancel', 'Отменить', function () { cancel(); renderPage(false); });
        button('back', 'Назад', function () { self.back(); });
        button('prev', 'Предыдущая', function () { pageNumber--; lastKey = ''; renderPage(true); }, pager);
        pager.append(pageLabel);
        button('next', 'Следующая', function () { pageNumber++; lastKey = ''; renderPage(true); }, pager);
        head.append(toolbar, status, notice, pager); html.append(head, scroll.render()); scroll.minus(head); scroll.append(grid);
        this.create = function () { controls(); return self.render(); };
        this.render = function () { return html; };
        this.start = function () {
            if (destroyed) return;
            active = true;
            L.Controller.add('content', {link: self, toggle: function () {
                L.Controller.collectionSet(html, false, true);
                var target = null;
                if (lastKey.indexOf('button:') === 0) target = buttons[lastKey.slice(7)];
                else bindings.some(function (b) { if ('group:' + b.group.key === lastKey) { target = b.card.render(); return true; } return false; });
                L.Controller.collectionFocus(target || false, html, true);
            }, up: function () { if (root.Navigator.canmove('up')) root.Navigator.move('up'); else L.Controller.toggle('head'); }, down: function () { root.Navigator.move('down'); }, right: function () { root.Navigator.move('right'); }, left: function () { if (root.Navigator.canmove('left')) root.Navigator.move('left'); else L.Controller.toggle('menu'); }, back: function () { self.back(); }});
            L.Controller.toggle('content');
            if (!initialized) { initialized = true; data = cache[cacheKey()] || null; if (data) { message = 'Подборка сохранена в памяти. Обновление — вручную.'; renderPage(false); } else begin(searching ? activeQuery : defaultQuery(), false); }
            else controls();
        };
        this.back = function () { cancel(); active = false; L.Activity.backward(); };
        this.pause = function () { active = false; };
        this.stop = function () { active = false; cancel('Загрузка остановлена при уходе. Полученные карточки сохранены; обновление — вручную.'); };
        this.destroy = function () { active = false; destroyed = true; cancel(); clearCards(); scroll.destroy(); html.remove(); };
    }
    function init() {
        if (registered) return;
        if (!L.Component || !L.Activity || !L.Menu || !L.Scroll || !L.Controller || !L.Select || !L.Input || !L.Template || !root.Navigator) { if (L.Noty) L.Noty.show('3D / VR: необходимые API Lampa недоступны.'); return; }
        registered = true;
        L.Component.add(NAME, Screen);
        var action = function () { L.Activity.push({component: NAME, title: '3D / VR', url: '', page: 1}); };
        var existing = L.Menu.render().find('[data-lampa-3d-vr="1"]');
        if (existing.length) existing.off('hover:enter').on('hover:enter', action);
        else {
            var element = $('<li class="menu__item selector" data-lampa-3d-vr="1"><div class="menu__ico"></div><div class="menu__text">3D / VR</div></li>');
            element.find('.menu__ico').text('3D');
            L.Menu.addElement(element, action);
        }
    }
    if (root.appready) init();
    else L.Listener.follow('app', function (event) { if (event.type === 'ready') init(); });
}(typeof window !== 'undefined' ? window : null));

}());
