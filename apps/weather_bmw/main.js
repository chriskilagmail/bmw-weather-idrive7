'use strict';

const https = require('https');
const dns = require('dns');
const urlLib = require('url');
const mgu = require('./kit/mgu');
const { Canvas } = require('./kit/canvas');

const LOCATIONS = {
    porto_alegre: { name: 'Porto Alegre', lat: -30.0346, lon: -51.2177 },
    gramado: { name: 'Gramado', lat: -29.3788, lon: -50.8742 },
    caxias: { name: 'Caxias do Sul', lat: -29.1678, lon: -51.1794 }
};

// Descrições WMO em português, mantendo os tipos de ícones já existentes.
const WEATHER = {
    0: ['Céu limpo', 'sun'],
    1: ['Predomínio de sol', 'suncloud'],
    2: ['Parcialmente nublado', 'suncloud'],
    3: ['Nublado', 'cloud'],
    45: ['Neblina', 'fog'], 48: ['Neblina com geada', 'fog'],
    51: ['Garoa fraca', 'rain'], 53: ['Garoa', 'rain'], 55: ['Garoa forte', 'rain'],
    56: ['Garoa congelante', 'rain'], 57: ['Garoa congelante forte', 'rain'],
    61: ['Chuva fraca', 'rain'], 63: ['Chuva', 'rain'], 65: ['Chuva forte', 'rain'],
    66: ['Chuva congelante', 'rain'], 67: ['Chuva congelante forte', 'rain'],
    71: ['Neve fraca', 'snow'], 73: ['Neve', 'snow'], 75: ['Neve forte', 'snow'],
    77: ['Grãos de neve', 'snow'],
    80: ['Pancadas fracas', 'rain'], 81: ['Pancadas de chuva', 'rain'],
    82: ['Pancadas fortes', 'rain'],
    85: ['Pancadas de neve', 'snow'], 86: ['Neve intensa', 'snow'],
    95: ['Trovoadas', 'storm'], 96: ['Trovoadas e granizo', 'storm'],
    99: ['Trovoadas e granizo forte', 'storm']
};

function weatherInfo(code) {
    return WEATHER[Number(code)] || ['Clima indisponível', 'cloud'];
}

function weatherSymbol(kind) {
    if (kind === 'sun') return '☀';
    if (kind === 'suncloud') return '☀';
    if (kind === 'cloud') return '☁';
    if (kind === 'fog') return '≋';
    if (kind === 'rain') return '☂';
    if (kind === 'snow') return '❄';
    if (kind === 'storm') return '⚡';
    return '•';
}

function getJson(url, timeoutMs) {
    return new Promise(function(resolve, reject) {
        let finished = false;
        let timer = null;
        let req = null;

        function done(err, value) {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            if (err) reject(err);
            else resolve(value);
        }

        function directLookup(hostname, options, callback) {
            if (typeof options === 'function') {
                callback = options;
            }

            dns.resolve4(hostname, function(err, addresses) {
                if (err) {
                    const e = new Error('Direct DNS failed for ' + hostname + ': ' + err.message);
                    done(e);
                    return callback(e);
                }

                if (!addresses || !addresses.length) {
                    const e = new Error('Direct DNS returned no address for ' + hostname);
                    done(e);
                    return callback(e);
                }

                callback(null, addresses[0], 4);
            });
        }

        try {
            // Bypass the BMW system resolver (127.0.0.1/dnsmasq).
            // mgu-uplink already permits this app UID to use wlan0, so
            // direct DNS queries from this process can leave via the hotspot.
            try {
                dns.setServers(['1.1.1.1', '8.8.8.8']);
            } catch (e) {
                // resolve4() below will return a useful error if this fails.
            }

            const parsed = urlLib.parse(url);
            const options = {
                protocol: 'https:',
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.path,
                method: 'GET',
                servername: parsed.hostname,
                headers: {
                    'Host': parsed.hostname,
                    'Accept': 'application/json',
                    'Connection': 'close'
                },
                lookup: directLookup
            };

            req = https.request(options, function(res) {
                let body = '';

                res.on('data', function(chunk) {
                    body += chunk.toString();
                });

                res.on('end', function() {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        done(new Error('HTTP ' + res.statusCode));
                        return;
                    }
                    try {
                        done(null, JSON.parse(body));
                    } catch (e) {
                        done(e);
                    }
                });

                res.on('error', function(err) {
                    done(err);
                });
            });

            req.on('error', function(err) {
                done(err);
            });

            req.end();

            timer = setTimeout(function() {
                if (finished) return;
                try {
                    if (req && req.abort) req.abort();
                } catch (e) {}
                done(new Error('Weather request timeout'));
            }, timeoutMs || 12000);

        } catch (e) {
            done(e);
        }
    });
}

function dayName(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    return ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][d.getUTCDay()] || '';
}

// O sistema Linux da MGU usa UTC, independentemente do fuso exibido no iDrive.
// Porto Alegre/RS utiliza UTC-03:00 (sem horário de verão atualmente).
// Fazemos o deslocamento sobre o timestamp e lemos os campos UTC para que a
// virada do dia, mês e ano fique correta, inclusive entre 00:00 e 02:59 UTC.
// O widget continua atualizando o relógio sem solicitar clima novamente.
function dataHoraLocal() {
    const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const weekdays = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
    const months = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    return {
        hora: hh + ':' + mm,
        dia: weekdays[now.getUTCDay()] + ', ' + now.getUTCDate(),
        mes: months[now.getUTCMonth()]
    };
}

// Texto curto para caber ao lado da temperatura no widget compacto.
function condicaoCompacta(code) {
    const n = Number(code);
    if (n === 0 || n === 1) return 'Ensolarado';
    if (n === 2) return 'Parcial. nublado';
    if (n === 3) return 'Nublado';
    if (n === 45 || n === 48) return 'Neblina';
    if (n >= 51 && n <= 57) return 'Garoa';
    if (n >= 61 && n <= 67) return 'Chuva';
    if (n >= 71 && n <= 77) return 'Neve';
    if (n >= 80 && n <= 82) return 'Pancadas';
    if (n === 85 || n === 86) return 'Neve';
    if (n >= 95) return 'Trovoadas';
    return 'Clima';
}

function temp(v) {
    if (v === null || v === undefined || isNaN(Number(v))) return '--';
    return Math.round(Number(v)).toString();
}

function rainPct(v) {
    if (v === null || v === undefined || isNaN(Number(v))) return 0;
    return Math.max(0, Math.min(100, Math.round(Number(v))));
}

function drawBmwLogo(cv, cx, cy, scale) {
    const s = scale || 1;
    const black = '#080A0D';
    const silver = '#D7DCE1';
    const white = '#F5F7FA';
    const blue = '#1572C4';

    cv.circle(cx, cy, 29 * s, silver);
    cv.circle(cx, cy, 26 * s, black);
    cv.circle(cx, cy, 17 * s, silver);
    cv.circle(cx, cy, 14 * s, white);
    cv.arc(cx, cy, 0, 14 * s, 0, 90, blue);
    cv.arc(cx, cy, 0, 14 * s, 180, 270, blue);
    cv.text('BMW', cx, cy - 17 * s, 7 * s, white, {
        align: 'center', font: 'bold', literal: true
    });
}

function drawIcon(cv, kind, cx, cy, s, color, dim) {
    const white = color || '#F4F6F8';
    const muted = dim || '#9AA5AF';
    const sunColor = '#F4C14E';
    const rainColor = '#62B7FF';
    const stormColor = '#FFCC4A';

    function cloud(x, y, scale) {
        cv.circle(x - 18 * scale, y, 22 * scale, white);
        cv.circle(x + 8 * scale, y - 10 * scale, 28 * scale, white);
        cv.circle(x + 35 * scale, y + 2 * scale, 20 * scale, white);
        cv.roundRect(x - 42 * scale, y, 92 * scale, 30 * scale, 15 * scale, white);
    }

    if (kind === 'sun' || kind === 'suncloud') {
        const sunX = cx - (kind === 'suncloud' ? 24 : 0);
        cv.circle(sunX, cy - 10, 30 * s, sunColor);
        for (let i = 0; i < 8; i++) {
            const a = Math.PI * 2 * i / 8;
            cv.line(
                sunX + Math.cos(a) * 42 * s,
                cy - 10 + Math.sin(a) * 42 * s,
                sunX + Math.cos(a) * 55 * s,
                cy - 10 + Math.sin(a) * 55 * s,
                4 * s,
                sunColor
            );
        }
        if (kind === 'suncloud') cloud(cx + 14 * s, cy + 12 * s, 0.72 * s);
        return;
    }

    if (kind === 'cloud') {
        cloud(cx, cy, s);
        return;
    }

    if (kind === 'fog') {
        cloud(cx, cy - 15 * s, 0.78 * s);
        for (let i = 0; i < 3; i++) {
            cv.line(cx - 48 * s, cy + 25 * s + i * 13 * s,
                cx + 48 * s, cy + 25 * s + i * 13 * s, 4 * s, muted);
        }
        return;
    }

    if (kind === 'rain') {
        cloud(cx, cy - 15 * s, 0.78 * s);
        for (let i = -1; i <= 1; i++) {
            cv.line(cx + i * 26 * s, cy + 18 * s,
                cx + (i * 26 - 8) * s, cy + 44 * s, 5 * s, rainColor);
        }
        return;
    }

    if (kind === 'snow') {
        cloud(cx, cy - 15 * s, 0.78 * s);
        for (let i = -1; i <= 1; i++) {
            const x = cx + i * 28 * s;
            cv.circle(x, cy + 32 * s, 5 * s, rainColor);
            cv.line(x - 8 * s, cy + 32 * s, x + 8 * s, cy + 32 * s, 2 * s, rainColor);
            cv.line(x, cy + 24 * s, x, cy + 40 * s, 2 * s, rainColor);
        }
        return;
    }

    if (kind === 'storm') {
        cloud(cx, cy - 18 * s, 0.78 * s);
        cv.quad([
            [cx - 8 * s, cy + 8 * s],
            [cx + 10 * s, cy + 8 * s],
            [cx - 2 * s, cy + 31 * s],
            [cx + 16 * s, cy + 31 * s]
        ], stormColor);
        cv.quad([
            [cx + 16 * s, cy + 31 * s],
            [cx - 6 * s, cy + 55 * s],
            [cx + 2 * s, cy + 34 * s],
            [cx - 12 * s, cy + 34 * s]
        ], stormColor);
        return;
    }

    cloud(cx, cy, s);
}

mgu.run({
    async start(ctx) {
        let state = {
            loading: true,
            error: null,
            fetchedAt: 0,
            place: 'Porto Alegre',
            unit: '°C',
            current: { temp: null, apparent: null, code: 3, wind: null },
            days: []
        };

        let timer = null;
        let inFlight = false;

        function settings() {
            const unit = ctx.settings.get('tempUnit') || 'c';
            const locKey = ctx.settings.get('location') || 'porto_alegre';
            return {
                unit: unit,
                loc: LOCATIONS[locKey] || LOCATIONS.porto_alegre,
                refreshMinutes: Number(ctx.settings.get('refreshMinutes') || 15)
            };
        }

        async function refresh() {
            if (inFlight) return;

            inFlight = true;
            state.loading = true;
            state.error = null;

            const s = settings();
            const tempUnit = s.unit === 'f' ? 'fahrenheit' : 'celsius';

            const url =
                'https://api.open-meteo.com/v1/forecast' +
                '?latitude=' + encodeURIComponent(s.loc.lat) +
                '&longitude=' + encodeURIComponent(s.loc.lon) +
                '&current=' + [
                    'temperature_2m',
                    'apparent_temperature',
                    'weather_code',
                    'wind_speed_10m'
                ].join(',') +
                '&daily=' + [
                    'weather_code',
                    'temperature_2m_max',
                    'temperature_2m_min',
                    'precipitation_probability_max'
                ].join(',') +
                '&temperature_unit=' + tempUnit +
                '&wind_speed_unit=kmh' +
                '&timezone=auto' +
                '&forecast_days=6';

            try {
                const j = await getJson(url, 12000);
                const days = [];

                if (j.daily && j.daily.time) {
                    for (let i = 0; i < j.daily.time.length; i++) {
                        days.push({
                            date: j.daily.time[i],
                            code: j.daily.weather_code[i],
                            max: j.daily.temperature_2m_max[i],
                            min: j.daily.temperature_2m_min[i],
                            rain: j.daily.precipitation_probability_max[i]
                        });
                    }
                }

                state = {
                    loading: false,
                    error: null,
                    fetchedAt: Date.now(),
                    place: s.loc.name,
                    unit: s.unit === 'f' ? '°F' : '°C',
                    current: {
                        temp: j.current && j.current.temperature_2m,
                        apparent: j.current && j.current.apparent_temperature,
                        code: j.current && j.current.weather_code,
                        wind: j.current && j.current.wind_speed_10m
                    },
                    days: days
                };

                ctx.log.info('Weather updated for ' + s.loc.name);
            } catch (e) {
                state.loading = false;
                state.error = e && e.message ? e.message : String(e);
                ctx.log.warn('Weather update failed: ' + state.error);
            } finally {
                inFlight = false;
            }

            if (timer) clearTimeout(timer);
            const mins = Math.max(5, settings().refreshMinutes);
            timer = setTimeout(refresh, mins * 60 * 1000);
        }

        ctx.ui.onClick('BTN_REFRESH', refresh);

        ctx.settings.onChange(function() {
            if (timer) clearTimeout(timer);
            refresh();
        });

        /* ---------------- Main app screen ---------------- */

        ctx.loop('MAIN', 2, function() {
            const t = ctx.theme();
            const cv = ctx.canvas(1600, 520).clear(t.bg);

            cv.gradientRect(0, 0, 1600, 520, [
                [0, '#0B1118'],
                [1, '#111C28']
            ]);

            cv.roundRect(34, 52, 1532, 430, 28, '#111923');
            cv.strokeRoundRect(34, 52, 1532, 430, 28, 2, '#233447');

            drawBmwLogo(cv, 1515, 88, 0.65);

            const info = weatherInfo(state.current.code);
            const accent = t.accent || '#4DB1FF';
            const text = t.text || '#F5F7FA';
            const dim = t.dim || '#9BA8B5';

            cv.text(state.place.toUpperCase(), 85, 103, 28, dim, {
                font: 'bold', literal: true
            });
            cv.text('AGORA', 85, 145, 20, accent, {
                font: 'bold', literal: true
            });

            drawIcon(cv, info[1], 208, 260, 1.05, text, dim);

            cv.text(temp(state.current.temp) + state.unit, 355, 265, 108, text, {
                font: 'num', literal: true
            });
            cv.text(info[0], 360, 320, 30, text, {
                font: 'bold', literal: true
            });

            cv.text('SENSAÇÃO '  + temp(state.current.apparent) + state.unit,
                360, 366, 22, dim, { font: 'label', literal: true });

            cv.text('VENTO ' +
                (state.current.wind === null || state.current.wind === undefined
                    ? '--' : Math.round(state.current.wind)) +
                ' km/h',
                360, 398, 22, dim, { font: 'label', literal: true });

            cv.line(625, 92, 625, 440, 2, '#273646');

            const forecast = state.days.slice(1, 6);
            const startX = 670;
            const cardW = 164;
            const gap = 16;
            const y = 112;
            const h = 300;

            for (let i = 0; i < 5; i++) {
                const d = forecast[i];
                const x = startX + i * (cardW + gap);

                cv.roundRect(x, y, cardW, h, 22, i === 0 ? '#172637' : '#141E29');
                cv.strokeRoundRect(x, y, cardW, h, 22, 1, i === 0 ? accent : '#263545');

                if (!d) continue;

                const wi = weatherInfo(d.code);

                cv.text(dayName(d.date), x + cardW / 2, y + 46, 22,
                    i === 0 ? accent : dim,
                    { align: 'center', font: 'bold', literal: true });

                drawIcon(cv, wi[1], x + cardW / 2, y + 118, 0.52, text, dim);

                cv.text(temp(d.max) + '°', x + cardW / 2 - 12, y + 214, 40, text, {
                    align: 'center', font: 'num', literal: true
                });

                cv.text(temp(d.min) + '°', x + cardW / 2 + 42, y + 214, 24, dim, {
                    align: 'center', font: 'num', literal: true
                });

                cv.text(rainPct(d.rain) + '% chuva', x + cardW / 2, y + 258, 18, dim, {
                    align: 'center', literal: true
                });
            }

            if (state.loading && !state.fetchedAt) {
                cv.roundRect(608, 205, 380, 82, 18, '#172330');
                cv.text('Atualizando clima...', 798, 258, 26, text, {
                    align: 'center', font: 'bold', literal: true
                });
            } else if (state.error) {
                cv.roundRect(625, 433, 640, 42, 16, '#3A2020');
                cv.text('Sem conexão - últimos dados', 945, 461, 20, '#FFB0A8', {
                    align: 'center', font: 'bold', literal: true
                });
            } else {
                const ago = state.fetchedAt
                    ? Math.max(0, Math.round((Date.now() - state.fetchedAt) / 60000))
                    : 0;

                cv.text('ATUALIZADO HÁ ' + ago + ' MIN', 1450, 460, 16, dim, {
                    align: 'right', font: 'label', literal: true
                });
            }

            return ctx.ui.image('MAIN_GFX', cv);
        });

        /* ---------- Home-screen compact visual v1.2.0 ----------
         * The stock DriveRecorder small template may suppress BackgroundImage1.
         * "imagem" is a controlled experiment. If blank on this unit, switch
         * Widget reduzido > Texto (compativel) without reinstalling.
         */
        if (ctx.widget) {
            const wcan = {};
            const wtext = {};

            function visualMode() {
                return (ctx.settings.get('widgetMode') || 'imagem') === 'imagem';
            }

            function setWidgetCells(inst) {
                if (!inst) return;
                const small = !inst.big;
                const isImage = small && visualMode();
                const local = dataHoraLocal();
                const compactTemp = temp(state.current.temp) +
                    (state.unit === '°F' ? 'F' : 'C');
                // Native fallback retains useful data if compact image is unsupported.
                // The compact RHMI template is not a freely positioned HTML canvas.
                const cells = {
                    Title: [small && !isImage ? local.dia : '', 'Text'],
                    TextRecordings: [small && !isImage ? local.mes : '', 'Text'],
                    TextCam: [small && !isImage ?
                        compactTemp + '  ' + condicaoCompacta(state.current.code) : '', 'Text'],
                    ProgressbarVisible: [false, 'Bool'],
                    Progress: [0, 'Float'],
                    TimeElapsed: ['', 'Text'],
                    TimeRemaining: ['', 'Text']
                };
                const prev = wtext[inst.spawnId] || (wtext[inst.spawnId] = {});
                Object.keys(cells).forEach(function(k) {
                    const value = cells[k][0], type = cells[k][1];
                    const key = JSON.stringify(value);
                    if (prev[k] === key) return;
                    prev[k] = key;
                    ctx.widget.set(inst.spawnId, k, value, type);
                });
            }

            function dayShortPt(iso) {
                const d = new Date(iso + 'T12:00:00Z');
                return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][d.getUTCDay()] || '--';
            }

            function renderCompactImage(cv, w, h) {
                const sx = w / 384, sy = h / 256;
                // Canvas has no transform in this runtime; the shipped widget
                // uses [384,256], so all coordinates below are native pixels.
                cv.fillRect(0, 0, w, h, '#101B2B');
                cv.gradientRect(0, 0, w, h, [
                    [0, '#34455E'], [0.5, '#152236'], [1, '#0C1524']
                ]);
                cv.line(7, 5, w - 7, 5, 2, '#CBD7E7');
                cv.line(7, h - 6, w - 7, h - 6, 1, '#68778B');
                const local = dataHoraLocal();
                const current = weatherInfo(state.current.code);
                // Date, big current reading and condition: left 45%.
                cv.text(local.dia + ' ' + local.mes, 15, 33, 17, '#F5F8FF', {
                    font: 'bold', literal: true
                });
                cv.text(temp(state.current.temp) + (state.unit === '°F' ? 'F' : 'C'),
                    15, 115, 63, '#FFFFFF', {font:'num',literal:true});
                cv.text(condicaoCompacta(state.current.code), 16, 151, 19, '#E7EDF7', {
                    font:'bold',literal:true
                });
                drawIcon(cv, current[1], 115, 192, 0.38, '#F3F7FF', '#CAD6E3');
                cv.line(173, 52, 173, 232, 1, '#71849A');
                // Upcoming 3 days: weather icons are drawn, not font glyphs.
                const days = state.days.slice(1,4);
                for (let i=0;i<3;i++) {
                    const d=days[i];
                    const cx=208+i*70;
                    if(i) cv.line(cx-36, 60, cx-36, 220, 1, '#46596F');
                    if (!d) continue;
                    const wi=weatherInfo(d.code);
                    cv.text(dayShortPt(d.date), cx, 86, 18, '#F4F7FF', {
                        font:'bold',align:'center',literal:true
                    });
                    cv.text(temp(d.max) + '°', cx, 132, 30, '#FFFFFF', {
                        font:'num',align:'center',literal:true
                    });
                    drawIcon(cv, wi[1], cx, 174, 0.27, '#E9F1FC', '#AABDD0');
                    cv.text(temp(d.min) + '°', cx, 220, 15, '#BCCDE2', {
                        align:'center',literal:true
                    });
                }
                if (state.error) cv.text('OFFLINE', 18, 240, 11, '#FFB1A6', {literal:true});
                return cv;
            }

            function renderWidget(inst) {
                setWidgetCells(inst);
                const sw = ctx.spec.startWidget || {};
                const size = sw.size || [384,256];
                const w = size[0], h = size[1], key = w+'x'+h;
                const cv = (wcan[key] = wcan[key] || new Canvas(w,h)).clear('#080F19');
                const info=weatherInfo(state.current.code);
                const text='#FFFFFF',dim='#C7CFD7',accent='#5EB8FF',line='#314151';
                if (!inst || !inst.big) {
                    return renderCompactImage(cv,w,h);
                }
                // Keep existing known-good large-widget drawing strategy.
                cv.fillRect(0,0,w,h,'#05080D');
                const top=12, contentBottom=182;
                cv.text(state.place.toUpperCase(),16,top+14,13,text,{
                    font:'bold',literal:true
                });
                cv.text('CLIMA',w-16,top+14,10,accent,{
                    align:'right',font:'bold',literal:true
                });
                drawIcon(cv,info[1],48,72,0.30,text,dim);
                cv.text(temp(state.current.temp)+state.unit,96,74,31,text,{
                    font:'num',literal:true
                });
                cv.text(info[0],98,98,13,text,{font:'bold',literal:true});
                cv.text('Sensacao '+temp(state.current.apparent)+state.unit,
                    98,116,10,dim,{literal:true});
                const wind=state.current.wind == null?'--':Math.round(state.current.wind);
                cv.text('Vento '+wind+' km/h',214,116,10,dim,{literal:true});
                cv.line(14,132,w-14,132,1,line);
                const days=state.days.slice(1,4),left=10,colW=(w-20)/3;
                for(let i=0;i<3;i++) {
                    const d=days[i];if(!d)continue;
                    const x0=left+i*colW,cx=x0+colW/2,wi=weatherInfo(d.code);
                    cv.text(dayShortPt(d.date),cx,148,10,i===0?accent:dim,{
                        align:'center',font:'bold',literal:true
                    });
                    drawIcon(cv,wi[1],cx-25,164,0.13,text,dim);
                    cv.text(temp(d.max)+'°',cx,168,15,text,{
                        align:'center',font:'num',literal:true
                    });
                    cv.text(temp(d.min)+'°',cx+28,168,10,dim,{
                        font:'num',literal:true
                    });
                    if(i<2)cv.line(x0+colW,140,x0+colW,contentBottom,1,line);
                }
                return cv;
            }
            ctx.widget.loop(1,renderWidget);
            if(ctx.widget.onChange)ctx.widget.onChange(function(){
                Object.keys(wtext).forEach(function(k){delete wtext[k];});
            });
        }

        refresh();
    }
});
