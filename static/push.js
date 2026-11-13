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
            'position:fixed', 'right:16px', 'bottom:16px', 'z-index:10000',
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

    async function iniciar() {
        // Si ya hay permiso, suscribir en silencio (renueva la suscripción en el servidor)
        if (soportado && Notification.permission === 'granted') {
            try {
                const r = await suscribir(false);
                if (r.ok) return;
            } catch (e) { /* mostrar botón */ }
        }

        const btn = crearBoton();
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Activando…';
            let r;
            try { r = await suscribir(true); } catch (e) { r = { ok: false, motivo: 'error' }; }
            if (r.ok) {
                btn.textContent = '✅ Alertas activadas';
                btn.style.background = '#10b981';
                btn.style.color = '#fff';
                setTimeout(() => btn.remove(), 2500);
            } else {
                btn.disabled = false;
                btn.textContent = '🔔 Activar alertas de pedidos';
                alert(mensaje(r.motivo));
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
