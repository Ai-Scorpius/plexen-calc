// ===========================================
// PLEXEN Calculator — tiny pub/sub emitter
// Shared by the state store and the calculator controller.
// Pure: no DOM, runs in Node and the browser alike.
// ===========================================

export function createEmitter() {
    const listeners = Object.create(null);

    return {
        on(event, fn) {
            (listeners[event] || (listeners[event] = [])).push(fn);
            return () => this.off(event, fn);
        },

        off(event, fn) {
            const arr = listeners[event];
            if (!arr) return;
            listeners[event] = arr.filter((f) => f !== fn);
        },

        emit(event, ...args) {
            const arr = listeners[event];
            if (!arr) return;
            arr.slice().forEach((fn) => fn(...args));
        },
    };
}
