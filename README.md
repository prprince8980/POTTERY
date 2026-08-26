# Shree brahmani krupa matla ghar

A Vite React client with an Express and MongoDB authentication API.

## Run locally

1. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI` and `JWT_SECRET`.
2. Run `npm run install:all` from the project root.
3. Run `npm run dev` from the project root.
4. Open `http://localhost:5173`.

The API runs on port 4000. Passwords are hashed with bcrypt and reset requests require the account name, email, and username before a new password can be saved.

## Admin

Choose `Admin` from the welcome screen and sign in using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `server/.env`. The Products section lists saved products and supports adding a product with its name, category, price, stock, and description.
