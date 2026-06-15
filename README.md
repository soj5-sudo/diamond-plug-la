# Diamond Plug LA — Custom Fine Jewelry Platform

Customers sign up, log in, click **Custom Design**, chat with an AI assistant, attach an STL, see it in 3D, and get a live price. Designers upload CAD files; admins assign, price, and manage. All synced to Supabase.

## Files

```
index.html          the whole site (landing, auth, portal)
css/styles.css      styling
js/config.js        your Supabase + Hugging Face keys (already filled in)
js/db.js            database queries + pricing engine (matches your schema)
js/viewer.js        3D viewer + STL/OBJ/3DM parsers
js/chatbot.js       AI design assistant + SVG art
js/main.js          app logic, auth, all role views
```

## Run it

- **Local:** open `index.html`, or run `npx serve .`
- **GitHub Pages:** push this folder → repo Settings → Pages → Source: `main` branch, root → Save. Live in ~1 min.
- **Vercel/Netlify:** import the repo (no build step) or drag the folder in.

Supabase is already configured in `js/config.js`. Database is set up (you ran both SQL blocks).

## Using it

- **Client** → sign up → **✦ Custom Design** → chat, attach STL → see it in 3D → request changes by chat → approve
- **Designer** → sign up as CAD Designer → assigned orders → upload STL/OBJ/3DM → read revision notes
- **Admin** → sign up as Admin → dashboard, assign designers, price with the estimator, edit the formula

## One Supabase setting (if signups seem stuck)

Supabase emails a confirmation link by default. To let people in immediately while testing:
**Supabase → Authentication → Providers → Email → turn off “Confirm email.”**

The AI assistant uses Hugging Face’s free API; if it’s ever busy, a built-in expert fallback keeps chatting and still logs revisions. 3D + .3dm support load from CDN (needs internet, like any web app).