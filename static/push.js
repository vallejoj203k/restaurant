// =============================================================
//  Alertas push (sonido + vibración aunque la pantalla esté bloqueada)
//  Archivo: static/push.js
//
//  Uso: <script src="/static/push.js" defer></script>
//  Muestra un botón flotante "Activar alertas" mientras el dispositivo
//  no esté suscrito. Al tocarlo pide permiso y registra el dispositivo
//  en el servidor (/push/suscribir).
// =============================================================
(function () {
    'use strict';

    const soportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
    }

    function mismaClave(sub, clave) {
        try {
            const actual = sub.options && sub.options.applicationServerKey;
            if (!actual) return true; // el navegador no la expone: asumir que sirve
            const a = new Uint8Array(actual);
            const b = urlBase64ToUint8Array(clave);
            return a.length === b.length && a.every((v, i) => v === b[i]);
        } catch (e) { return true; }
    }

    async function obtenerClavePublica() {
        const res = await fetch('/push/vapid_public');
        const dat = await res.json();
        return dat.publicKey || '';
    }

    async function suscribir(pedirPermiso) {
        if (!soportado) return { ok: false, motivo: 'no-soportado' };

        const registro = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;

        let permiso = Notification.permission;
        if (permiso === 'default' && pedirPermiso) permiso = await Notification.requestPermission();
        if (permiso !== 'granted') return { ok: false, motivo: permiso === 'denied' ? 'denegado' : 'sin-permiso' };

        const clave = await obtenerClavePublica();
        if (!clave) return { ok: false, motivo: 'sin-vapid' };

        let sub = await registro.pushManager.getSubscription();
        if (sub && !mismaClave(sub, clave)) {
            // Suscripción hecha con otras claves → rehacerla
            try { await sub.unsubscribe(); } catch (e) { /* ignorar */ }
            sub = null;
        }
        if (!sub) {
            sub = await registro.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(clave)
            });
        }

        const res = await fetch('/push/suscribir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON())
        });
        return { ok: res.ok, motivo: res.ok ? '' : 'servidor' };
    }

    // ── Botón flotante ───────────────────────────────────────
    function crearBoton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btn-activar-alertas';
        btn.textContent = '🔔 Activar alertas de pedidos';
        btn.style.cssText = [
            'position:fixed', 'left:16px', 'bottom:16px', 'z-index:10000',
            'background:#f59e0b', 'color:#111', 'border:none', 'border-radius:999px',
            'padding:12px 18px', 'font-weight:800', 'font-size:15px', 'cursor:pointer',
            'box-shadow:0 8px 24px rgba(0,0,0,.25)', 'max-width:calc(100vw - 32px)'
        ].join(';');
        document.body.appendChild(btn);
        return btn;
    }

    function mensaje(motivo) {
        switch (motivo) {
            case 'no-soportado':
                return esIOS && !instalada
                    ? 'En iPhone primero agrega la app a la pantalla de inicio (Compartir → "Agregar a inicio") y ábrela desde ahí.'
                    : 'Este navegador no soporta alertas. Usa Chrome en Android.';
            case 'denegado':
                return 'Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador para este sitio y vuelve a intentar.';
            case 'sin-vapid':
                return 'El servidor no tiene configuradas las claves de notificación (VAPID). Avisa al administrador.';
            default:
                return 'No se pudieron activar las alertas. Intenta de nuevo.';
        }
    }

    async function probar() {
        const res = await fetch('/push/probar', { method: 'POST' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    function explicarPrueba(d) {
        if (!d.push_disponible) return 'El servidor no tiene instalada la librería de notificaciones (pywebpush).';
        if (!d.claves_vapid) return 'El servidor no tiene claves de notificación (VAPID).';
        if (!d.dispositivos) return 'Este usuario (' + d.usuario + ') no tiene ningún dispositivo registrado. Toca "Activar alertas" otra vez.';
        if (d.enviadas) {
            return '✅ Prueba enviada a ' + d.enviadas + ' dispositivo(s) de ' + d.usuario + '.\n\n' +
                   'Si no te apareció ni sonó, revisa en el teléfono: notificaciones permitidas para el navegador/app, ' +
                   'modo silencio o "No molestar" apagado y ahorro de batería desactivado para el navegador.' +
                   (d.errores.length ? '\n\nOtros dispositivos con error: ' + d.errores.join(' | ') : '');
        }
        return 'No se pudo entregar la notificación: ' + d.errores.join(' | ');
    }

    function modoProbar(btn) {
        btn.disabled = false;
        btn.textContent = '🔔 Probar alerta';
        btn.style.background = '#1f2937';
        btn.style.color = '#fff';
        btn.style.padding = '8px 14px';
        btn.style.fontSize = '13px';
        btn.style.opacity = '0.85';
        btn.dataset.modo = 'probar';
    }

    async function iniciar() {
        const btn = crearBoton();

        // Si ya hay permiso, suscribir en silencio (renueva la suscripción y el usuario en el servidor)
        if (soportado && Notification.permission === 'granted') {
            try {
                const r = await suscribir(false);
                if (r.ok) modoProbar(btn);
            } catch (e) { /* queda el botón de activar */ }
        }

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            if (btn.dataset.modo === 'probar') {
                btn.textContent = 'Enviando prueba…';
                try {
                    // volver a registrar por si cambió el usuario o la suscripción
                    await suscribir(false);
                    alert(explicarPrueba(await probar()));
                } catch (e) {
                    alert('No se pudo hacer la prueba: ' + e.message);
                }
                modoProbar(btn);
                return;
            }

            btn.textContent = 'Activando…';
            let r;
            try { r = await suscribir(true); } catch (e) { r = { ok: false, motivo: 'error', detalle: e.message }; }
            if (r.ok) {
                modoProbar(btn);
                try { alert(explicarPrueba(await probar())); } catch (e) { /* ignorar */ }
            } else {
                btn.disabled = false;
                btn.textContent = '🔔 Activar alertas de pedidos';
                alert(mensaje(r.motivo) + (r.detalle ? '\n\n(' + r.detalle + ')' : ''));
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
