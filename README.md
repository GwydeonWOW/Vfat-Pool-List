# Liquidity Pool Analyzer

Panel privado para filtrar y comparar pools de liquidez concentrada de VFat,
Raydium, Turbos, Uniswap, Orca y Cetus.

## Desarrollo

```powershell
npm install
$env:AUTH_USER='admin'
$env:AUTH_PASS='use-a-long-random-password'
npm start
```

El frontend de desarrollo se inicia por separado con `npm run dev`. La base de
datos SQLite y sus snapshots se guardan en `data/app.sqlite`.

Uniswap queda desactivado hasta configurar `UNISWAP_API_KEY`. Si el contrato de
la API contratada usa otra URL, configure también `UNISWAP_API_URL`; el adaptador
acepta una colección en `pools` o `data.pools`.

Los fallos de cualquier proveedor externo se registran como estado degradado y
no detienen el servidor. `CETUS_API_URL` permite sustituir el endpoint público de
Cetus si no está disponible desde la región del despliegue.

## Verificación

```powershell
npm test
npm run build
npm audit --omit=dev
```

En Docker debe montarse `/app/data` como volumen persistente y suministrarse las
variables de `.env.example`. La primera ejecución migra automáticamente un
`data/auth.json` antiguo a un hash `scrypt` dentro de SQLite y elimina el archivo
en texto plano.
