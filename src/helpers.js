// Centralized helpers registry used to avoid fragile globalThis hoisting
// and to provide a single place to register runtime helpers and state.
const ctx = {};

export function register(map = {}) {
  Object.assign(ctx, map);
}

// A runtime proxy which provides either the raw value (for non-functions)
// or a callable wrapper (for functions) so callers can safely call e.g.
// exposed.adminLog(...) even if the concrete implementation is registered
// later during startup.
export const exposed = new Proxy({}, {
  get(target, prop) {
    const v = ctx[prop];
    if (typeof v === 'function') return (...args) => v(...args);
    return v;
  }
});

export function getContext() { return ctx; }

export default { register, exposed, getContext };
