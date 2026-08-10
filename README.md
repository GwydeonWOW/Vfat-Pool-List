# Liquidity Pool Analyzer

Panel privado para filtrar y comparar pools de liquidez concentrada de VFat,
Raydium, Turbos, Uniswap, Orca y Cetus.

El score de oportunidad simula una posición de 400 USD y prioriza un beneficio
neto mínimo de 30 USD diarios. Parte del APR potencial, limita el ingreso por los
rewards diarios totales del pool y descuenta realización imperfecta, tiempo fuera
de rango, slippage y costes de rebalanceo. Los escenarios conservador,
equilibrado y agresivo cambian esos descuentos, no el capital simulado.
La puntuación usa una escala abierta: 100 equivale al objetivo de 30 USD netos
diarios, 150 aproximadamente al doble y 200 aproximadamente a cuatro veces el
objetivo. Las pools por debajo del objetivo permanecen entre 0 y 99.
Las farms VFat con nombre `CL<número>-...` reciben una bonificación de prioridad
de 12 puntos si superan el objetivo y de 5 puntos si no lo alcanzan; una pool no
rentable nunca puede superar 99 únicamente por esta bonificación.

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
