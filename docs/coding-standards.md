# Paryx Coding Standards

- No customer-specific names, assets, course data or operational rules in application source.
- UUID primary keys and explicit foreign keys.
- Row Level Security for tenant data.
- No secrets in frontend code or Git.
- Database permission checks must not rely on hidden UI alone.
- Use `window.Paryx` for the temporary browser namespace; do not introduce legacy product names.
- Keep staff and member user experiences separate.
- Prefer service-layer calls over direct table queries as the platform matures.
- Use semantic HTML, CSS variables and accessible controls.
- New database migrations should represent one logical platform change.
