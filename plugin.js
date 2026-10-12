/* Lampa 3D / VR, local v0.1.0. No catalog, settings writes or player links.
 * Contracts: yumata/lampa-source 7cb2ce0ce320070785ca0be4f43a14f638c1d7d8.
 * ES5 syntax; Lampa and its bundled jQuery are the only runtime dependencies.
 */
(function (root) {
    'use strict';
    var NAME = 'lampa_3d_vr_search';
    var GUARD = '__lampa_3d_vr_search_v1';
    var MODES = [
        {id: '3d', title: '3D-кино'},
        {id: 'vr180', title: 'VR180'},
        {id: '360', title: '360°'}
    ];

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

    // CommonJS is only for the offline fixture harness. Browser registration below.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {classify: classify, prepare: prepare, key: key, btih: btih};
    }
    if (!root || !root.Lampa || !root.jQuery || root[GUARD]) return;
    root[GUARD] = {registered: false};
    var L = root.Lampa, $ = root.jQuery;
    var requestOwner = null;

    function Screen(object) {
        var self = this;
        var scroll = new L.Scroll({mask: true, over: true});
        var html = $('<div class="lampa-3d-vr"></div>');
        var head = $('<div style="padding:1em"></div>');
        var query = String(object.search || '');
        var mode = object.mode || '3d';
        var serial = 0, pending = false, destroyed = false, active = false, timer = null, last = null;
        var status = $('<div style="padding:1em;opacity:.85" role="status"></div>');
        var edit = $('<div class="simple-button selector"></div>');
        var choose = $('<div class="simple-button selector"></div>');
        var search = $('<div class="simple-button selector">Искать</div>');
        var cancel = $('<div class="simple-button selector">Отменить поиск</div>');
        var exit = $('<div class="simple-button selector">Назад</div>');
        head.append(edit, choose, search, cancel, exit, status);
        html.append(head, scroll.render());
        scroll.minus(head);
        scroll.body().addClass('torrent-list');

        function modeTitle() {
            for (var i = 0; i < MODES.length; i++) if (MODES[i].id === mode) return MODES[i].title;
            return MODES[0].title;
        }
        function controls() {
            edit.text('Запрос: ' + (query || 'введите текст'));
            choose.text('Режим: ' + modeTitle());
            cancel.toggleClass('hide', !pending);
        }
        function focus() { if (active && !destroyed && L.Controller.enabled().name === 'content') self.start(); }
        function message(text) { status.text(text); controls(); focus(); }
        function abort() {
            serial++;
            clearTimeout(timer);
            timer = null;
            if (pending && requestOwner === self) {
                requestOwner = null;
                if (L.Parser && typeof L.Parser.clear === 'function') L.Parser.clear();
            }
            pending = false;
        }
        function end(id) {
            if (destroyed || id !== serial || !pending) return false;
            pending = false;
            clearTimeout(timer);
            timer = null;
            if (requestOwner === self) requestOwner = null;
            return true;
        }
        function resetList() { last = null; scroll.clear(); scroll.reset(); }
        function display(result) {
            resetList();
            result.items.forEach(function (row) {
                var element = row.element;
                var date = element.PublishDate ? L.Utils.parseTime(element.PublishDate).full : '';
                var size = isFinite(Number(element.Size)) && Number(element.Size) > 0 ? L.Utils.bytesToSize(Number(element.Size)) : element.size || '';
                var item = L.Template.get('torrent', {
                    title: escapeHTML(element.Title), date: escapeHTML(date), tracker: escapeHTML(element.Tracker),
                    bitrate: '', size: escapeHTML(size), seeds: escapeHTML(element.Seeders), grabs: escapeHTML(element.Peers)
                });
                item.find('.bitrate').remove();
                if (!size) item.find('.torrent-item__size').remove();
                item.append($('<div style="padding:.3em 0;opacity:.8"></div>').text(row.format.label + ' — не проверено по видео'));
                item.on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
                item.on('hover:enter', function () {
                    if (destroyed) return;
                    if (!L.Torrent || typeof L.Torrent.start !== 'function') { message('Штатное открытие торрентов недоступно в этой сборке Lampa.'); return; }
                    // The native global-search contract uses the untouched Parser item.
                    L.Torrent.back(function () { if (!destroyed) self.start(); });
                    L.Torrent.start(element, {title: element.Title});
                });
                scroll.append(item);
            });
            var detail = 'Источник вернул: ' + result.total + '. В режиме «' + modeTitle() + '»: ' + result.items.length + '. Дубликатов: ' + result.duplicates + '.';
            if (result.skipped) detail += ' Некорректных записей: ' + result.skipped + '.';
            if (!result.items.length) detail += ' По выбранным меткам ничего не найдено; это не доказывает отсутствие контента у источника.';
            message(detail);
        }

        this.search = function () {
            if (destroyed) return;
            abort();
            query = query.trim();
            if (!query) { message('Введите непустой запрос.'); return; }
            resetList();
            if (!L.Parser || typeof L.Parser.get !== 'function') { message('Lampa.Parser недоступен в этой сборке.'); return; }
            if (requestOwner && requestOwner !== self) { message('Другой экран 3D / VR ещё выполняет поиск. Вернитесь к нему и отмените поиск.'); return; }
            var id = serial;
            pending = true;
            requestOwner = self;
            message('Поиск через настроенный Parser… Запрос: ' + query);
            // Parser has no return handle and may stay silent for an unknown backend.
            timer = setTimeout(function () {
                if (destroyed || id !== serial || !pending) return;
                abort();
                message('Parser не завершил поиск за 60 секунд. Можно повторить поиск вручную.');
            }, 60000);
            try {
                L.Parser.get({search: query, from_search: true, other: true}, function (data) {
                    if (!end(id)) return;
                    try { display(prepare(data, mode)); }
                    catch (e) { resetList(); message('Ответ Parser не удалось обработать. Проверьте совместимость сборки Lampa.'); }
                }, function () {
                    if (!end(id)) return;
                    // Do not display/log raw errors: they can contain source URLs/keys.
                    message('Parser сообщил ошибку. Возможны ненастроенный источник или отказ доступа (в том числе 403). Результаты неизвестны. Повтор — только вручную.');
                });
            } catch (e) {
                if (id !== serial || destroyed) return;
                abort();
                message('Не удалось запустить Parser. Проверьте совместимость и существующую настройку источника.');
            }
        };
        edit.on('hover:enter', function () {
            abort();
            controls();
            // Input.edit returns its value on BOTH Enter and Back. Therefore input
            // only updates a draft; a separate Search button is the sole trigger.
            L.Input.edit({title: 'Запрос 3D / VR (поиск кнопкой «Искать»)', value: query, free: true, nosave: true}, function (value) {
                if (destroyed) return;
                query = String(value || '');
                resetList();
                message('Черновик запроса. Нажмите «Искать» для обращения к Parser.');
                self.start();
            });
        });
        choose.on('hover:enter', function () {
            abort();
            controls();
            L.Select.show({title: 'Режим 3D / VR', items: MODES.map(function (m) { return {id: m.id, title: m.title, selected: m.id === mode}; }),
                onSelect: function (selected) { if (destroyed) return; mode = selected.id; resetList(); message('Режим изменён. Нажмите «Искать».'); self.start(); },
                onBack: function () { if (!destroyed) self.start(); }
            });
        });
        search.on('hover:enter', function () { self.search(); });
        cancel.on('hover:enter', function () { abort(); message('Поиск отменён. Поздний ответ не изменит экран.'); });
        exit.on('hover:enter', function () { self.back(); });
        head.find('.selector').on('hover:focus', function (e) { last = e.target; });

        this.create = function () { controls(); status.text('Метки — предположения по названию. SBS не доказывает сферический VR. Введите запрос и нажмите «Искать».'); return self.render(); };
        this.render = function () { return html; };
        this.start = function () {
            if (destroyed) return;
            active = true;
            L.Controller.add('content', {
                toggle: function () { L.Controller.collectionSet(html, false, true); L.Controller.collectionFocus(last || false, html, true); },
                up: function () { if (root.Navigator.canmove('up')) root.Navigator.move('up'); else L.Controller.toggle('head'); },
                down: function () { root.Navigator.move('down'); },
                left: function () { if (root.Navigator.canmove('left')) root.Navigator.move('left'); else L.Controller.toggle('menu'); },
                right: function () { root.Navigator.move('right'); },
                back: function () { self.back(); }
            });
            L.Controller.toggle('content');
        };
        this.back = function () { abort(); active = false; L.Activity.backward(); };
        this.pause = function () { active = false; };
        this.stop = function () { active = false; var wasPending = pending; abort(); controls(); if (wasPending) status.text('Поиск прерван при уходе с экрана. Повторите его кнопкой «Искать».'); };
        this.destroy = function () { active = false; destroyed = true; abort(); scroll.destroy(); html.remove(); last = null; };
    }

    function init() {
        if (root[GUARD].registered) return;
        if (!L.Component || !L.Activity || !L.Menu || !L.Scroll || !L.Controller || !L.Input || !L.Select || !L.Template || !L.Utils || !root.Navigator) {
            if (L.Noty) L.Noty.show('3D / VR: необходимые API Lampa недоступны.');
            return;
        }
        L.Component.add(NAME, Screen);
        var icon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="6" width="20" height="12" rx="4" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="12" r="3" stroke="currentColor"/><circle cx="16" cy="12" r="3" stroke="currentColor"/></svg>';
        var element = $('<li class="menu__item selector" data-lampa-3d-vr="1"><div class="menu__ico"></div><div class="menu__text">3D / VR</div></li>');
        element.find('.menu__ico').append(icon);
        if (!L.Menu.render().find('[data-lampa-3d-vr="1"]').length) {
            L.Menu.addElement(element, function () { L.Activity.push({url: '', title: '3D / VR', component: NAME, page: 1}); });
        }
        root[GUARD].registered = true;
    }
    if (root.appready) init();
    else L.Listener.follow('app', function (event) { if (event.type === 'ready') init(); });
}(typeof window !== 'undefined' ? window : null));
