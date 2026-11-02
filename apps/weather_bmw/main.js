'use strict';

const https = require('https');
const mgu = require('./kit/mgu');
const { Canvas } = require('./kit/canvas');

const LOCATIONS = {
    porto_alegre: { name: 'Porto Alegre', lat: -30.0346, lon: -51.2177 },
    gramado: { name: 'Gramado', lat: -29.3788, lon: -50.8742 },
    caxias: { name: 'Caxias do Sul', lat: -29.1678, lon: -51.1794 }
};

const WEATHER = {
    0: ['Clear', 'sun'],
    1: ['Mostly clear', 'suncloud'],
    2: ['Partly cloudy', 'suncloud'],
    3: ['Cloudy', 'cloud'],
    45: ['Fog', 'fog'], 48: ['Fog', 'fog'],
    51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'],
    56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'],
    61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
    66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
    71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
    80: ['Rain showers', 'rain'], 81: ['Rain showers', 'rain'], 82: ['Heavy showers', 'rain'],
    85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
    95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm', 'storm'], 99: ['Thunderstorm', 'storm']
};

function weatherInfo(code) {
    return WEATHER[Number(code)] || ['Weather', 'cloud'];
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

        try {
            // Kept deliberately simple for the MGU Node.js 8 runtime.
            req = https.get(url, function(res) {
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
    return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()] || '';
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
            cv.text('NOW', 85, 145, 20, accent, {
                font: 'bold', literal: true
            });

            drawIcon(cv, info[1], 208, 260, 1.05, text, dim);

            cv.text(temp(state.current.temp) + state.unit, 355, 265, 108, text, {
                font: 'num', literal: true
            });
            cv.text(info[0], 360, 320, 30, text, {
                font: 'bold', literal: true
            });

            cv.text('FEELS ' + temp(state.current.apparent) + state.unit,
                360, 366, 22, dim, { font: 'label', literal: true });

            cv.text('WIND ' +
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

                cv.text(rainPct(d.rain) + '% rain', x + cardW / 2, y + 258, 18, dim, {
                    align: 'center', literal: true
                });
            }

            if (state.loading && !state.fetchedAt) {
                cv.roundRect(608, 205, 380, 82, 18, '#172330');
                cv.text('Updating weather...', 798, 258, 26, text, {
                    align: 'center', font: 'bold', literal: true
                });
            } else if (state.error) {
                cv.roundRect(625, 433, 640, 42, 16, '#3A2020');
                cv.text('Offline - showing last data', 945, 461, 20, '#FFB0A8', {
                    align: 'center', font: 'bold', literal: true
                });
            } else {
                const ago = state.fetchedAt
                    ? Math.max(0, Math.round((Date.now() - state.fetchedAt) / 60000))
                    : 0;

                cv.text('UPDATED ' + ago + ' MIN AGO', 1450, 460, 16, dim, {
                    align: 'right', font: 'label', literal: true
                });
            }

            return ctx.ui.image('MAIN_GFX', cv);
        });

        /* ---------------- Home-screen widget ----------------
         *
         * BMW's LT_Table_OnlineApps_DriveRecorderWidget behaves differently
         * by size:
         *   - big: the BackgroundImage1 picture is shown
         *   - small: the picture is not shown; native cells carry the content
         *
         * This mirrors the working eDrive implementation from idrive7-apps.
         */

        if (ctx.widget) {
            const wcan = {};
            const wtext = {};

            function setWidgetCells(inst) {
                if (!inst) return;

                const small = !inst.big;
                const info = weatherInfo(state.current.code);
                const tomorrow = state.days[1] || null;
                const rain = tomorrow ? rainPct(tomorrow.rain) : 0;
                const wind = state.current.wind === null || state.current.wind === undefined
                    ? '--'
                    : Math.round(state.current.wind);

                const cells = {
                    Title: [small ? 'Weather' : '', 'Text'],
                    TextRecordings: [
                        small ? (temp(state.current.temp) + state.unit + '   ' + info[0]) : '',
                        'Text'
                    ],
                    TextCam: [small ? state.place : '', 'Text'],
                    ProgressbarVisible: [small && !!tomorrow, 'Bool'],
                    Progress: [small && tomorrow ? rain : 0, 'Float'],
                    TimeElapsed: [
                        small && tomorrow
                            ? ('Tomorrow ' + temp(tomorrow.max) + '° / ' + temp(tomorrow.min) + '°')
                            : (small && state.loading ? 'Updating...' : ''),
                        'Text'
                    ],
                    TimeRemaining: [
                        small
                            ? (state.error ? 'Offline' : ('Wind ' + wind + ' km/h'))
                            : '',
                        'Text'
                    ]
                };

                const prev = wtext[inst.spawnId] || (wtext[inst.spawnId] = {});

                Object.keys(cells).forEach(function(k) {
                    const value = cells[k][0];
                    const type = cells[k][1];
                    const serialized = JSON.stringify(value);
                    if (prev[k] === serialized) return;
                    prev[k] = serialized;
                    ctx.widget.set(inst.spawnId, k, value, type);
                });
            }

            function renderWidget(inst) {
                setWidgetCells(inst);

                const sw = ctx.spec.startWidget || {};
                const size = sw.size || [384, 256];
                const safe = sw.safe || [0.09, 0.1];
                const w = size[0];
                const h = size[1];
                const key = w + 'x' + h;

                // The small widget ignores this image, but the callback still returns one.
                const cv = (wcan[key] = wcan[key] || new Canvas(w, h))
                    .clear([0, 0, 0, 0]);

                if (!inst || !inst.big) return cv;

                const sx = safe[0];
                const sy = safe[1];
                const x0 = Math.round(w * sx);
                const x1 = w - x0;
                const y0 = Math.round(h * sy);
                const y1 = h - y0;
                const iw = x1 - x0;

                // Compact big-widget design: deliberately smaller than the PC preview,
                // because the HMI scales the image up and crops a fixed share at the edges.
                cv.gradientRect(0, 0, w, h, [
                    [0, '#0B1118'],
                    [1, '#162333']
                ]);

                const info = weatherInfo(state.current.code);
                const text = '#F5F7FA';
                const dim = '#9BA8B5';
                const accent = '#70BFFF';

                cv.text(state.place, x0, y0 + 18, 15, dim, {
                    font: 'bold', literal: true
                });

                drawBmwLogo(cv, x1 - 10, y0 + 12, 0.26);

                drawIcon(cv, info[1], x0 + 33, y0 + 72, 0.33, text, dim);

                cv.text(temp(state.current.temp) + state.unit,
                    x0 + 74, y0 + 78, 36, text,
                    { font: 'num', literal: true });

                cv.text(info[0], x0 + 76, y0 + 100, 13, text, {
                    font: 'bold', literal: true
                });

                cv.text('Feels ' + temp(state.current.apparent) + state.unit,
                    x0 + 76, y0 + 120, 11, dim, { literal: true });

                const wind = state.current.wind === null || state.current.wind === undefined
                    ? '--'
                    : Math.round(state.current.wind);

                cv.text('Wind ' + wind + ' km/h',
                    x0 + 76, y0 + 137, 11, dim, { literal: true });

                cv.line(x0, y0 + 151, x1, y0 + 151, 1, '#2C3B4B');

                const days = state.days.slice(1, 4);
                const colW = iw / 3;

                for (let i = 0; i < 3; i++) {
                    const d = days[i];
                    if (!d) continue;

                    const cx = x0 + colW * i + colW / 2;
                    const wi = weatherInfo(d.code);

                    cv.text(dayName(d.date), cx, y0 + 170, 11,
                        i === 0 ? accent : dim,
                        { align: 'center', font: 'bold', literal: true });

                    drawIcon(cv, wi[1], cx - 25, y0 + 194, 0.18, text, dim);

                    cv.text(temp(d.max) + '°', cx, y0 + 199, 15, text, {
                        font: 'num', literal: true
                    });

                    cv.text(temp(d.min) + '°', cx + 27, y0 + 199, 11, dim, {
                        font: 'num', literal: true
                    });

                    cv.text(rainPct(d.rain) + '%', cx, Math.min(y1 - 4, y0 + 218), 10, dim, {
                        align: 'center', literal: true
                    });

                    if (i < 2) {
                        cv.line(x0 + colW * (i + 1), y0 + 163,
                            x0 + colW * (i + 1), y1 - 3, 1, '#263645');
                    }
                }

                if (state.loading && !state.fetchedAt) {
                    cv.text('Updating...', (x0 + x1) / 2, y1 - 8, 12, accent, {
                        align: 'center', font: 'bold', literal: true
                    });
                } else if (state.error) {
                    cv.text('Offline', x1, y1 - 8, 11, '#FFB0A8', {
                        align: 'right', font: 'bold', literal: true
                    });
                }

                return cv;
            }

            ctx.widget.loop(1, renderWidget);

            if (ctx.widget.onChange) {
                ctx.widget.onChange(function() {
                    Object.keys(wtext).forEach(function(k) {
                        delete wtext[k];
                    });
                });
            }
        }

        refresh();
    }
});
