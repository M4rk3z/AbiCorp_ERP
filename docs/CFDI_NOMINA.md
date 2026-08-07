# CFDI de nómina

## Estado de la fase 9

La implementación actual incluye:

- periodos de nómina configurables;
- lectura de CFDI 4.0 con complemento de Nómina 1.2;
- validación previa del XML y rechazo de DTD o entidades;
- UUID único y detección de duplicados;
- asociación por ID laboral, RFC y CURP;
- bandejas de CFDI no relacionados y coincidencias ambiguas;
- asociación manual con motivo e historial;
- XML y PDF privados fuera de PostgreSQL;
- metadatos, hashes SHA-256, permisos y auditoría en PostgreSQL;
- notificación, consulta, descarga, confirmación y aclaración desde el portal del colaborador.

La carga masiva, la resolución administrativa de aclaraciones y la constancia PDF se desarrollarán sobre estas mismas tablas.

## Almacenamiento privado

En desarrollo local se usa `data/private` de forma predeterminada. Esa carpeta está excluida de Git.

Con PostgreSQL el sistema no permite cargar CFDI hasta configurar almacenamiento S3 compatible. Esto evita guardar archivos en el disco efímero de Render.

Variables para Render:

```text
ERP_PRIVATE_STORAGE_PROVIDER=s3
ERP_PRIVATE_STORAGE_BUCKET=nombre-del-bucket
ERP_PRIVATE_STORAGE_REGION=auto
ERP_PRIVATE_STORAGE_ENDPOINT=https://endpoint-s3-del-proveedor
ERP_PRIVATE_STORAGE_ACCESS_KEY_ID=clave-de-acceso
ERP_PRIVATE_STORAGE_SECRET_ACCESS_KEY=secreto
ERP_PRIVATE_STORAGE_FORCE_PATH_STYLE=false
```

Para AWS S3 se puede omitir `ERP_PRIVATE_STORAGE_ENDPOINT` y se debe indicar la región real. Para R2 normalmente se usa `auto` y su endpoint S3. Otros servicios pueden necesitar `ERP_PRIVATE_STORAGE_FORCE_PATH_STYLE=true`.

El bucket debe ser privado. Las credenciales deben limitarse a leer, crear y eliminar objetos únicamente dentro del bucket o prefijo destinado a ABICORP. El navegador nunca recibe estas credenciales ni una URL pública: toda descarga pasa por la API, comprueba permisos, valida el hash y registra la auditoría.

## Referencia fiscal implementada

El lector admite CFDI 4.0 con complemento de Nómina 1.2 y registra, entre otros datos:

- UUID y fecha de timbrado;
- RFC de emisor y receptor;
- CURP, NSS e ID laboral del receptor;
- tipo de nómina ordinaria o extraordinaria;
- fechas del periodo y fecha de pago;
- días pagados;
- percepciones, deducciones, otros pagos y total.

Referencias oficiales:

- https://wwwmat.sat.gob.mx/consultas/97722/comprobante-de-nomina
- https://wwwmat.sat.gob.mx/articulo/75619/regla-2.7.5.2
