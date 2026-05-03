## Supabase (Magic Link + Allowlist)

### 1) Criar projeto

- Crie um projeto no Supabase.
- Em Authentication → Providers, habilite Email.

### 2) URLs de redirect (obrigatório para magic link)

- Authentication → URL Configuration:
  - Site URL: `https://cinemastream-psi.vercel.app`
  - Redirect URLs:
    - `https://cinemastream-psi.vercel.app/*`
    - `http://localhost:5173/*`

### 3) Variáveis de ambiente (Vercel)

Configure no projeto da Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 4) Banco (schema + allowlist)

No Supabase SQL Editor, execute:

- `supabase/schema.sql`

Depois, insira seu email (allowlist inicial):

```sql
insert into public.allowed_emails (email) values ('SEU_EMAIL_AQUI');
```

### 5) Como o app se comporta

- Navegação (Home/Buscar/Detalhes) funciona sem login.
- Ao tocar em “Abrir no VLC (Recomendado)”, o app abre um modal de login:
  - envia magic link
  - valida allowlist (`allowed_emails`)
  - executa a ação pendente após o login
