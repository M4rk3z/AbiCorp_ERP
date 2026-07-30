# Abicorp ERP

Aplicación web ERP modular. Funciona localmente y crea automáticamente sus bases SQLite dentro de `data/`.

## Inicio rápido

Requiere Node.js 22.5 o posterior.

```powershell
npm start
```

Después abre `http://127.0.0.1:5050`.

Este repositorio contiene exclusivamente la aplicación ERP operativa. El Centro
de Gestión externo no forma parte del código publicado.

También puedes abrir `public/index.html` con Live Server de VS Code. En ese
modo debes mantener `npm start` ejecutándose porque Live Server muestra la
interfaz, pero el servidor del ERP continúa administrando la autenticación y
la base SQLite en el puerto 5050.

Acceso inicial:

- Usuario: `admin`
- Contraseña: `Cambiar123!`

La aplicación obliga a reemplazar la contraseña durante el primer acceso. Las credenciales iniciales pueden cambiarse mediante las variables `ERP_INITIAL_ADMIN_USER` y `ERP_INITIAL_ADMIN_PASSWORD` antes de crear la base por primera vez.

## Núcleo incluido

- Inicio y cierre de sesión con sesiones guardadas en SQLite.
- Cambio obligatorio de contraseña inicial.
- Usuarios, activación y bloqueo.
- Acceso personalizado por usuario, módulo y nivel de control.
- Roles y permisos en cuatro niveles.
- Permisos editables con límites por nivel: consulta, operación, supervisión y administración.
- Catálogos de empresas, sucursales, áreas, almacenes, unidades, monedas y estados documentales.
- Folios y consecutivos por sucursal con reinicio opcional mensual o anual.
- Repositorio local de archivos y documentos de hasta 8 MB.
- Notificaciones internas por usuario o para todos los usuarios activos.
- Áreas y asignación de usuarios.
- Artículos clasificados como productos terminados, materias primas, consumibles, herramientas, servicios o activos.
- Maestros de clientes, proveedores y empleados.
- Recursos clasificados como máquinas, centros de trabajo, herramientas o personal.
- Listas de precios y costos con moneda, vigencia, cantidades mínimas y partidas por artículo.
- Folios automáticos para empresas, sucursales, áreas, almacenes y todos los módulos maestros.
- Inventario por artículo, almacén, ubicación y lote, con existencia física, reservada y disponible.
- Entradas, salidas, transferencias y ajustes con folios automáticos y protección contra saldos negativos.
- Reservas de existencia con liberación o consumo mediante una salida automática.
- Trazabilidad por lotes y números de serie, además de un mapa de ubicaciones de almacén.
- Conteos físicos con fotografía del saldo, captura de diferencias y ajuste autorizado al cierre.
- Prospectos con embudo comercial, valor estimado y conversión automática a cliente.
- Cotizaciones con precios, descuentos, impuestos, vigencia y aceptación controlada.
- Pedidos directos o generados desde cotizaciones, con confirmación y avance de surtimiento.
- Entregas y devoluciones enlazadas a pedidos que actualizan el inventario automáticamente.
- Facturación comercial interna con vencimiento, referencia fiscal y seguimiento de pago.
- Configuración general.
- Bitácora de movimientos.
- Migraciones y datos iniciales automáticos.
- Protección de contraseñas con `scrypt`, cookies `HttpOnly` y validación CSRF.

## Pruebas

```powershell
npm test
```
