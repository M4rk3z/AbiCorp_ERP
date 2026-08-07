# ABICORP ERP - Manual operativo de Recursos Humanos

Este manual describe solamente el modulo de Recursos Humanos, el Portal del
Colaborador y la parte del Centro de Gestion que administra sus accesos.

## 1. Conceptos que no deben confundirse

ABICORP utiliza dos niveles distintos de empresa:

1. **Empresa administrada o entorno ERP.** Se crea en el Centro de Gestion y
   determina la base o esquema PostgreSQL aislado donde vive la informacion.
2. **Empresa laboral.** Se registra dentro del ERP en Catalogos generales y se
   utiliza en expedientes, centros de trabajo, departamentos y alcances de RH.

Crear la empresa administrada no crea actualmente un registro de empresa
laboral. Por eso una empresa puede aparecer en el Centro de Gestion y, al mismo
tiempo, la lista **Empresas autorizadas** puede estar vacia.

La lista **Trabajador vinculado** tambien permanece en `Sin vinculo` hasta que
exista por lo menos un expediente de colaborador dentro del mismo entorno.

## 2. Direcciones y ambientes

| Ambiente | Centro de Gestion | ERP | Portal del colaborador |
| --- | --- | --- | --- |
| Produccion local | `http://127.0.0.1:5051` | `http://127.0.0.1:5050` si se ejecuta localmente, o la URL del servicio de Render | URL del ERP seguida de `/portal` |
| Pruebas | `http://127.0.0.1:5151` | `http://127.0.0.1:5150` | `http://127.0.0.1:5150/portal` |

No se deben combinar ambientes. Un usuario creado en el Centro de Gestion de
pruebas solamente aparecera en un ERP que utilice la misma base PostgreSQL y el
mismo esquema de empresa. El ERP de produccion no mostrara los registros de
pruebas.

Para iniciar el ERP de pruebas ejecute `INICIAR_ERP_PRUEBAS.cmd`. El proceso se
mantiene en segundo plano y el navegador se abre cuando PostgreSQL responde. Use
`DETENER_ERP_PRUEBAS.cmd` para apagar solamente el ERP de pruebas; el Centro de
Gestion en el puerto 5151 permanece encendido.

El ERP es una aplicacion de una sola pagina. Las rutas que aparecen en este
manual son recorridos de menu, no direcciones web independientes.

## 3. Arranque desde cero

Este procedimiento resuelve el caso en que no existen empresas laborales,
centros, trabajadores ni usuarios operativos.

### 3.1 Crear el primer acceso tecnico

Ruta: **Centro de Gestion > Empresas administradas > seleccionar la empresa >
Nueva identidad**.

Capture:

- Usuario: un identificador administrativo, por ejemplo `admin.rh.inicial`.
- Nombre completo y correo: los datos de la persona responsable.
- Contrasena temporal: una contrasena segura. El usuario debera cambiarla al
  iniciar por primera vez.
- Perfil de acceso: **Sin perfil laboral**.
- Trabajador vinculado: **Sin vinculo**.
- Modulos autorizados:
  - Nucleo operativo: nivel 2 o superior. Permite registrar la empresa y el area.
  - Recursos humanos: nivel 4.
  - Dashboards: nivel 1; se agrega automaticamente cuando corresponde.

No seleccione todavia **Administrador RH**, **Empresa** ni **Centro de trabajo**.
Esas opciones dependen de catalogos que aun no existen. El perfil `Sin perfil
laboral` no significa que el usuario quede sin permisos: los permisos operativos
provienen de los modulos seleccionados.

### 3.2 Registrar la empresa laboral

1. Inicie sesion en el ERP del mismo ambiente con el acceso tecnico.
2. Abra **Nucleo > Catalogos generales**.
3. Seleccione la pestana **Empresas**.
4. Pulse **Nueva empresa**.
5. Capture razon social, nombre comercial y RFC o identificacion fiscal.
6. Guarde. El codigo se asigna automaticamente con formato `EMP-00001`.
7. En el mismo apartado, registre por lo menos un **Area**.

La empresa creada aqui es la que aparecera en **Empresas autorizadas** del
Centro de Gestion.

### 3.3 Convertir el acceso tecnico en Administrador RH

1. Regrese al Centro de Gestion y vuelva a seleccionar la empresa administrada.
2. Abra el usuario creado en el paso 3.1.
3. En **Perfil de acceso**, seleccione **Administrador RH**.
4. En **Alcance**, seleccione **Empresa**.
5. En **Empresas autorizadas**, seleccione la empresa laboral recien creada.
   En una lista multiple de Windows se usa `Ctrl + clic` para elegir mas de una.
6. Mantenga **Trabajador vinculado** en `Sin vinculo` si el administrador no tiene
   todavia expediente. Este vinculo no es obligatorio para Administrador RH.
7. Active solamente los permisos sensibles necesarios:
   - Salarios.
   - CFDI.
   - Documentos medicos.
8. Guarde el acceso.

## 4. Estructura organizacional requerida por RH

Antes de crear colaboradores deben existir, como minimo:

1. Empresa laboral.
2. Centro de trabajo.
3. Departamento.
4. Area.
5. Puesto.
6. Turno, cuando aplique.
7. Plan de vacaciones.

Rutas disponibles actualmente:

- Empresa y area: **Nucleo > Catalogos generales**.
- Puestos, turnos y planes de vacaciones: **Recursos humanos > Catalogos**.

### Limitacion actual importante

La base de datos y las reglas de RH ya contemplan centros de trabajo y
departamentos, pero la interfaz actual no ofrece una pantalla para darlos de
alta. El formulario de colaborador si los exige. Por seguridad, no se recomienda
resolver esta omision capturando SQL manual en produccion.

Antes de completar el primer expediente se debe incorporar al ERP el catalogo
visual de **Centros de trabajo** y **Departamentos**. Hasta entonces, el arranque
puede llegar al paso 3.3, pero no es posible completar correctamente la
adscripcion laboral de un colaborador nuevo desde la interfaz.

## 5. Alta de colaboradores

Ruta: **Recursos humanos > Nuevo personal**.

Datos de adscripcion requeridos por la interfaz:

- Empresa.
- Centro de trabajo.
- Departamento.
- Administrador responsable, cuando corresponda.

Datos necesarios para que el expediente se considere completo:

- Nombre completo, CURP, RFC y NSS.
- Fecha de nacimiento.
- Domicilio: calle, colonia, municipio, estado y codigo postal.
- Contacto y telefono de emergencia.
- Empresa, centro, departamento, area y puesto.
- Fecha de ingreso y tipo de contratacion.
- Contrato y periodicidad de nomina.
- Documentos obligatorios vigentes.

El numero de colaborador se asigna automaticamente con formato `E-00000`.

Para varios colaboradores use **Recursos humanos > Carga masiva**:

1. Descargue la plantilla XLSX.
2. Use los codigos existentes de empresa, centro, departamento, area y puesto.
3. Cargue el archivo para validacion.
4. Corrija todas las filas marcadas con error.
5. Confirme la importacion. No se guarda ninguna fila si el lote contiene
   errores de validacion.

## 6. Vincular un usuario con un colaborador

Despues de crear el expediente:

1. Abra **Centro de Gestion > empresa administrada > Nueva identidad**, o edite
   una identidad existente.
2. Seleccione el perfil **Colaborador**.
3. Seleccione el registro en **Trabajador vinculado**.
4. El alcance cambia automaticamente a **Informacion propia**.
5. Asigne los modulos estrictamente necesarios.
6. Guarde.

Un colaborador solo puede vincularse con una identidad. El perfil Colaborador no
puede recibir alcance de empresa o centro.

Para **Auxiliar RH** y **Administrador RH**, el alcance permitido es Empresa o
Centro de trabajo. El vinculo con un expediente es opcional.

## 7. Operacion diaria de Recursos Humanos

### Expedientes

Ruta: **Recursos humanos**.

- Crear o editar personal.
- Consultar antiguedad, contrato, turno y vacaciones.
- Registrar baja con motivo.
- Revisar alertas de expediente incompleto.
- Cargar documentos desde **Nucleo > Archivos y documentos** y clasificarlos
  como general, fiscal, salarial, CFDI o medico.

### Vacaciones, permisos e incapacidades

Ruta: **Recursos humanos > fila del colaborador > accion correspondiente**.

- Vacaciones: valida saldo, traslapes, fines de semana, festivos, incapacidades y
  cobertura.
- Vacaciones adelantadas: pueden solicitarse sin saldo; el Administrador RH
  decide si autoriza la deuda.
- Permisos: permiten dias completos u horas y distinguen permisos con o sin goce.
- Incapacidades: permiten registrar certificado y conservar la informacion
  medica bajo permiso sensible.

El flujo se configura en **Recursos humanos > Portal colaboradores**:

- Con aprobacion de jefe: Colaborador -> Jefe de area -> Administrador RH.
- Sin aprobacion de jefe, o sin jefe asignado: Colaborador -> Administrador RH.

Todas las decisiones conservan estado, comentarios, responsable y fecha.

### Horarios

Ruta: **Recursos humanos > Horarios**.

- Crear periodos semanales.
- Aplicar el turno predeterminado.
- Copiar la semana anterior.
- Importar horarios.
- Publicar una version.
- Capturar horario real y comparar contra el programado.
- Solicitar y aprobar correcciones sin borrar el valor anterior.

### Portal del colaborador

Administracion: **Recursos humanos > Portal colaboradores**.

Acceso del trabajador: URL del ERP seguida de `/portal`.

- El Administrador RH puede activar o desactivar el portal completo.
- Puede habilitar o bloquear a cada colaborador.
- El PIN temporal predeterminado es `0000` y debe cambiarse en el primer acceso.
- El Administrador RH puede restablecer el PIN.
- La sesion y el PIN temporal tienen la vigencia configurada en el panel.
- El colaborador consulta su expediente, saldo, horarios, solicitudes,
  notificaciones, documentos y CFDI autorizados.

## 8. Matriz resumida de acceso

| Perfil | Alcance | Vinculo con trabajador | Informacion sensible |
| --- | --- | --- | --- |
| Sin perfil laboral | Segun modulos | No | No debe usarse como acceso habitual; sirve para el arranque inicial |
| Colaborador | Propia | Obligatorio | Solo su informacion y permisos expresamente concedidos |
| Auxiliar RH | Empresa o centro | Opcional | Salario, CFDI y medico se habilitan individualmente |
| Administrador RH | Empresa o centro | Opcional | Puede recibir permisos sensibles individualmente |

Nomina es un modulo compartido entre RH y Finanzas, no un perfil laboral. Tener
acceso a Nomina no concede automaticamente acceso a documentos medicos.

## 9. Diagnostico rapido

### `Empresas autorizadas` esta vacio

No existe una empresa laboral activa en el entorno. Siga los pasos 3.1 y 3.2.
Crear otra empresa administrada en el Centro de Gestion no resuelve este caso.

### `Centros autorizados` esta vacio

No existen centros de trabajo activos. La interfaz de alta esta pendiente; no
modifique PostgreSQL manualmente para sortearlo.

### `Trabajador vinculado` solo muestra `Sin vinculo`

Todavia no existe un expediente de colaborador en ese entorno, o se esta
consultando un ambiente distinto.

### El usuario se creo pero no aparece en el ERP

Compruebe que el Centro de Gestion y el ERP estan conectados a la misma base
PostgreSQL y al mismo esquema de empresa. Revise tambien que el usuario este
Activo y tenga por lo menos un modulo autorizado.

### Mensaje `Selecciona al menos una empresa autorizada`

El perfil Auxiliar RH o Administrador RH tiene alcance Empresa, pero no se marco
ningun elemento de la lista multiple. Si la lista esta vacia, complete primero el
arranque del apartado 3.

## 10. Regla de seguridad para ambientes

- Configure y pruebe cambios de RH en la base de pruebas.
- No copie URL, usuarios ni datos personales entre pruebas y produccion.
- No use consultas SQL directas para crear catalogos operativos.
- Conserve separados documentos medicos, salarios y CFDI.
- Antes de una migracion o carga masiva en produccion, valide primero la misma
  operacion en pruebas.
