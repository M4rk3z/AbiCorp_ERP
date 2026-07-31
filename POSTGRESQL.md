# Migración de ABICORP a PostgreSQL

La migración usa el respaldo SQLite local y una base PostgreSQL vacía de Render.
No se deben pegar credenciales en Git, archivos del proyecto ni conversaciones.

## 1. Simulación local

Desde PowerShell, en la carpeta del proyecto:

~~~powershell
.\migrate-postgres.cmd
~~~

La simulación comprueba las bases, empresas, tablas, registros y dependencias.
No se conecta a Render y no modifica PostgreSQL.

## 2. Migración

En Render, abre la base PostgreSQL y copia temporalmente su **External Database
URL**. Después ejecuta:

~~~powershell
.\migrate-postgres.cmd -Confirm
~~~

El script solicita escribir **MIGRAR** y después pide la URL de forma oculta.
La credencial solo se conserva en el entorno del proceso mientras se realiza la
migración. Al finalizar se elimina.

El proceso:

1. crea los esquemas **control** y **tenant_<empresa>**;
2. copia todas las tablas y registros;
3. ajusta secuencias e identificadores;
4. guarda fotografías y documentos dentro de PostgreSQL;
5. compara cada tabla mediante cantidad y SHA-256;
6. confirma todo en una sola transacción.

Si ocurre un error, la transferencia de datos se revierte.

## 3. Activación

Solo después de una migración aprobada se sube el código a GitHub. El Web
Service debe tener:

~~~text
DATABASE_PROVIDER=postgres
DATABASE_URL=<Internal Database URL enlazada desde Render>
~~~

El ERP alojado usa la URL interna. El Centro de Gestión local debe usar la URL
externa mediante un iniciador seguro; nunca debe incluirse en el repositorio.

## Repetir una migración

Una segunda ejecución se bloquea para proteger los datos. Para reemplazar
intencionalmente una migración existente:

~~~powershell
.\migrate-postgres.cmd -Confirm -Replace
~~~

Esta opción sustituye las tablas de destino con el contenido del respaldo.

## Centro de Gestión local

Después de verificar la migración, inicia el panel conectado a la misma base:

~~~powershell
.\start-control-postgres.cmd
~~~

Pega la **External Database URL** cuando se solicite. La URL permanece oculta y
solo existe mientras la ventana está abierta. Después abre:

~~~text
http://127.0.0.1:5051
~~~

Usa el administrador del Centro de Gestión que existía en el respaldo. Mantén
la ventana de PowerShell abierta y presiona **Ctrl+C** para apagar el panel.
