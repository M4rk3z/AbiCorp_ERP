# ABICORP ERP - Requisitos tecnicos de Recursos Humanos

Estado: Validado funcionalmente por el propietario  
Version: 0.7  
Fecha: 2026-08-03  
Rama objetivo: `codex/hr-integral`

## 1. Objetivo y limites

Convertir el documento "Proyecto de Plataforma Integral de Gestion de Recursos
Humanos" en funciones implementables, verificables y compatibles con la
arquitectura multiempresa de ABICORP ERP.

Este documento define requisitos; no autoriza todavia migraciones ni cambios en
produccion. Toda construccion y prueba se realizara primero contra
`abicorp_rh_test`.

## 2. Situacion actual

ABICORP ya dispone de:

- Empresas, sucursales, areas, usuarios, roles y permisos por modulo.
- Expedientes basicos con fotografia, alta, baja y estado laboral.
- Puestos, tipos de contratacion y turnos con multiples jornadas semanales.
- Planes automaticos y saldos basicos de vacaciones.
- Solicitudes basicas de permiso, vacaciones e incapacidad.
- Notificaciones internas y bitacora general.
- Almacenamiento de documentos y fotografias dentro de PostgreSQL.

Brechas principales:

- El trabajador no esta relacionado de forma obligatoria con empresa, planta,
  sucursal o centro de trabajo.
- Las areas actuales no tienen una jerarquia organizacional completa.
- No existe portal de autoservicio con acceso limitado al propio trabajador.
- El flujo de ausencias no representa por separado jefe, RH y Nominas.
- Faltan calendario laboral, dias festivos y reglas de cobertura.
- No existen prenomina, CFDI de nomina ni evidencia de consulta.
- Los documentos no tienen clasificacion de sensibilidad ni politica de
  conservacion por tipo.
- Los permisos actuales de RH son generales y no separan salario, CFDI y salud.
- El registro tecnico de entradas y salidas existente no se considerara reloj
  checador ni horario real en esta actualizacion.

## 3. Principios obligatorios

1. Aislamiento por empresa: ningun dato de una empresa debe aparecer en otra.
2. Minimo privilegio: salario, CFDI y datos medicos tendran permisos separados.
3. Trazabilidad: las decisiones y correcciones no se sobreescriben; se versionan.
4. Eliminacion logica: no se eliminara fisicamente informacion sensible desde la
   interfaz ordinaria.
5. Configuracion antes que codigo fijo: vacaciones, festivos, permisos,
   periodicidad y exportaciones se configuran por empresa.
6. Privacidad por diseno: un jefe ve la ausencia y sus fechas, pero no el
   diagnostico medico.
7. Compatibilidad: las migraciones deben conservar todos los expedientes y
   solicitudes existentes.

## 4. Prioridades

### P0 - Fundamentos, seguridad y migracion

- Modelo organizacional por empresa y centro de trabajo.
- Relacion usuario-trabajador, organigrama y alcances de RH y Nominas.
- Expediente ampliado con estados `draft`, `incomplete`, `active` e `inactive`.
- Permisos separados para datos personales, salarios, CFDI y salud.
- Clasificacion documental, control de descarga, conservacion y auditoria.
- Catalogos configurables y migracion segura de datos actuales.

### P1 - Ausencias y autoservicio

- Portal del trabajador limitado a su propio expediente y solicitudes.
- Vacaciones con calendario laboral, saldos, traslapes y autorizacion de RH.
- Permisos con goce y sin goce con flujos y avisos configurables.
- Incapacidades con documentos protegidos y vista restringida para jefes.
- Calendario por area y centro de trabajo sin exponer datos medicos.
- Notificaciones dentro de la plataforma y por correo electronico.

### P2 - Horarios, incidencias y prenomina

- Horarios programados versionados por semana.
- Horarios reales capturados o importados, sin asumir reloj checador.
- Comparacion programado-real y catalogo de incidencias.
- Periodos de prenomina, autorizacion, cierre y reapertura controlada.
- Exportacion generica XLSX/CSV y perfiles de exportacion configurables.

### P3 - CFDI y evidencia digital

- Carga individual y masiva de XML/PDF.
- Relacion automatica con el trabajador y bandeja de pendientes.
- Deteccion de UUID duplicado y relacion de sustitucion.
- Consulta, descarga, confirmacion y solicitud de aclaracion.
- Evidencia digital y constancia descargable.

### P4 - Integraciones posteriores

- Aplicaciones moviles, notificaciones push, SMS y WhatsApp.
- Integracion con biometrico o reloj checador.
- Integracion directa con sistema de nomina.
- Firma electronica avanzada e integraciones institucionales.

## 5. Expediente digital

### 5.1 Regla de obligatoriedad

El sistema permitira guardar un expediente incompleto como borrador. Para
marcarlo como activo se validaran los campos obligatorios del perfil aplicable.
Esto permite iniciar el alta sin inventar informacion faltante.

### 5.2 Campos minimos para crear un borrador

- Nombre completo.
- Empresa.
- Centro de trabajo.
- Area o departamento.
- Puesto.
- Fecha de ingreso.
- Tipo de contratacion.
- Estado inicial.

El numero de empleado sera generado por el sistema o importado con validacion de
unicidad dentro de la empresa.

### 5.3 Campos obligatorios para registrar o activar un trabajador

- Numero de empleado.
- Nombre(s), primer apellido y segundo apellido cuando exista.
- CURP, RFC y NSS.
- Empresa, centro de trabajo, area y puesto.
- Fecha de ingreso, tipo de contrato y vigencia cuando corresponda.
- Periodicidad de pago.

Campos condicionales o recomendados:

- Correo electronico obligatorio para activar acceso por correo y recibir avisos.
- Turno o condicion expresa de "sin turno" para calcular cobertura y calendario.
- Fecha de nacimiento, telefono y contacto de emergencia cuando la empresa los
  requiera para su operacion.

El jefe inmediato sera opcional y se utilizara para representar el organigrama,
no para autorizar vacaciones o permisos. La opcion separada "Guardar borrador"
podra conservar un expediente incompleto, pero no permitira activarlo ni generar
acceso al portal hasta completar los campos obligatorios.

Campos como estado civil, domicilio, sexo y tipo de sangre se almacenaran solo
si existe una finalidad definida. El tipo de sangre sera siempre opcional.

### 5.4 Validaciones

- Numero de empleado unico por empresa.
- RFC y CURP normalizados; duplicados requieren permiso especial y justificacion.
- Fecha de ingreso no posterior a la baja.
- Jefe activo y dentro de un alcance organizacional permitido.
- Prohibicion de ciclos de jefatura.
- Contratos temporales deben tener fecha final.
- Contratistas y practicantes conservan sus reglas actuales diferenciadas.
- La baja requiere fecha, motivo, responsable y evidencia cuando corresponda.

## 6. Modelo organizacional

Jerarquia propuesta:

`Empresa -> Unidad organizacional -> Area/departamento -> Puesto -> Trabajador`

Una unidad organizacional tendra un tipo configurable: `planta`, `sucursal`,
`centro_trabajo`, `oficina` u `otro`. Podra depender de otra unidad para permitir,
por ejemplo, una planta con varios centros de trabajo. El Administrador de RH
podra agregar unidades, cambiar su jerarquia y desactivarlas. Una unidad con
historial no se eliminara fisicamente: se desactivara para conservar expedientes,
solicitudes, calendarios y reportes anteriores.

Cada trabajador tendra:

- `company_id` obligatorio.
- `organization_unit_id` obligatorio.
- `area_id` obligatorio.
- `position_id` obligatorio.
- `manager_employee_id` cuando el puesto tenga jefe.
- `user_id` cuando tenga acceso de autoservicio.

RH y Nominas tendran alcances asignables por empresa, unidad o area. El alcance
sera independiente del nivel general del modulo.

## 7. Jerarquia y flujo de decisiones

Flujo base confirmado:

1. El trabajador crea o envia una solicitud.
2. El sistema valida saldo, politica, traslapes y cobertura disponible.
3. El Administrador de RH consulta el cupo, autoriza, rechaza o solicita
   correccion. El jefe inmediato no participa en el flujo dentro del sistema.
4. Nominas, como parte de Finanzas, recibe solamente las incidencias con efecto
   economico ya autorizadas; no aprueba vacaciones.
5. Nominas marca la incidencia o el periodo como procesado.

El Administrador de RH tambien podra crear y autorizar directamente una solicitud
de permiso o vacaciones en nombre del colaborador cuando lo considere necesario.
La operacion exigira motivo, usuario responsable y notificacion al colaborador;
se identificara con origen `admin_direct` y no omitira la bitacora.

Cada etapa guardara usuario, rol ejercido, fecha, decision, motivo, comentario y
version de la solicitud. Un rechazo requerira motivo. Una correccion no eliminara
la version anterior.

## 8. Vacaciones y dias festivos

La politica sera configurable por empresa y, cuando aplique, por centro de
trabajo:

- Planes por antiguedad y fecha efectiva.
- Calendario de dias festivos por anio y ubicacion.
- Semana laboral obtenida del turno del trabajador.
- Anticipacion minima.
- Dias bloqueados o periodos de alta operacion.
- Permitir o prohibir saldo adelantado.
- Acumulacion, vencimiento y transferencia de saldo.
- Porcentaje maximo de ausencia y cobertura minima del area.
- Tratamiento de descansos y festivos dentro de una solicitud.
- Orden de consumo de los ciclos vacacionales.
- Avisos automaticos al trabajador tres meses y un mes antes del vencimiento.
- Cupo maximo configurable por area por el Administrador de RH, considerando el
  numero de personas y los turnos que requieren cobertura.

Regla de saldo confirmada:

- La solicitud ordinaria requiere dias disponibles.
- Cada ciclo vacacional dura un anio, calculado desde el aniversario de ingreso
  del colaborador. El saldo del ciclo vence al terminar ese ciclo anual.
- Cualquier colaborador activo que tenga habilitado el beneficio puede solicitar
  adelanto cuando no tenga dias disponibles.
- No existe un limite numerico general para el adelanto: el colaborador solicita
  los dias que necesita y el Administrador de RH decide autorizar o rechazar.
- Antes de enviar una solicitud adelantada, el sistema mostrara al trabajador los
  dias solicitados, saldo actual, deuda resultante y aviso expreso de adelanto.
- El adelanto se registrara como deuda vacacional auditable y no como saldo
  disponible ordinario.
- El panel mostrara disponibilidad del area, cupo restante y turnos sin cobertura
  antes de que RH tome la decision.
- El Administrador de RH podra otorgar dias, corregir saldos o registrar vacaciones
  directamente. En lugar de sobrescribir el saldo, el sistema creara un movimiento
  de ajuste con cantidad, ciclo, motivo, fecha y responsable.

Criterios de aceptacion:

- El calculo distingue dias naturales, laborables, descansos y festivos.
- No permite traslape con otra ausencia aprobada.
- Una incapacidad validada prevalece sobre vacaciones y permisos.
- El saldo cambia solo despues de la autorizacion final.
- Cancelar o revertir una solicitud deja movimiento de saldo auditable.
- El Administrador de RH consulta el calendario, cupo y cobertura antes de decidir.

## 9. Permisos e incapacidades

### 9.1 Permisos con goce

- Dia completo o parcial.
- Motivo configurable.
- Justificacion, cobertura, adjuntos y comentarios.
- Autorizacion exclusiva del Administrador de RH.
- Efecto de nomina configurable, sin descuento por defecto.

### 9.2 Permisos sin goce

- Horas o dias solicitados.
- Aceptacion expresa del posible descuento, guardando version del aviso.
- Autorizacion exclusiva del Administrador de RH.
- Envio obligatorio a prenomina despues de la autorizacion final.
- Evidencia de procesamiento por Nominas.

### 9.3 Incapacidades

- Tipo, fechas, dias, folio del documento medico cuando exista, institucion,
  archivo y estado de validacion. Este folio no numera la solicitud interna.
- El diagnostico o subtipo medico se considera dato sensible.
- Jefes y calendarios generales solo muestran `incapacidad`, fechas y estado.
- RH autorizado o Salud Ocupacional puede consultar el documento y detalle.
- Una incapacidad no se transforma automaticamente en vacaciones o permiso.

### 9.4 Identificadores

- Los tipos de permiso e incapacidad seran catalogos configurables con un ID
  interno estable.
- Cada solicitud conservara un ID interno o UUID para consulta, relaciones y
  auditoria.
- No se exigira folio secuencial ni numeracion visible como regla de negocio.
- La interfaz identificara las solicitudes por persona, tipo, fechas y estado; el
  ID tecnico se mostrara solamente cuando sea necesario para soporte o auditoria.

## 10. Nomina y prenomina

La periodicidad sera un dato maestro administrado por el Administrador de RH y
configurable por empresa: semanal, catorcenal, quincenal, mensual u otra. Un
trabajador se relacionara con una periodicidad activa.

Estados del periodo:

`open -> capture -> review -> hr_validated -> payroll_sent -> processed -> closed`

La reapertura exigira permiso especial, motivo y bitacora. El cierre genera una
instantanea de datos para impedir que cambios posteriores alteren el archivo ya
procesado.

La salida canonica incluira empleado, empresa, centro, periodo, tipo de
incidencia, unidad, cantidad, efecto, estado y responsables. ABICORP incluira una
plantilla estandar XLSX/CSV. Cada empresa podra crear un perfil propio que mapee,
ordene, renombre, agregue u omita columnas sin cambiar los datos originales. El
formato especifico de un proveedor de nomina se implementara como otro perfil de
exportacion.

## 11. Acceso a informacion sensible

Permisos propuestos:

| Informacion | Colaborador | Auxiliar RH | Administrador RH | Modulo Nomina | Admin tecnico |
| --- | --- | --- | --- | --- | --- |
| Expediente basico | Propio | Alcance asignado | Alcance asignado | Minimo requerido por permiso | Sin acceso por defecto |
| Salario | Propio, si se habilita | No por defecto | Si, con permiso sensible | Si, con permiso funcional | No |
| CFDI | Propio | Metadatos | Si, con permiso sensible | Si, con permiso funcional | No |
| Documento medico | Propio | No por defecto | Si, con permiso sensible | No | No |
| Diagnostico medico | Propio | No | Si, con permiso sensible | No | No |
| Prenomina | No | Preparacion autorizada | Validacion laboral | Proceso compartido RH/Finanzas | No |

Los perfiles de identidad son exclusivamente `Colaborador`, `Auxiliar RH` y
`Administrador RH`. El jefe inmediato sigue siendo una relacion organizacional
del expediente, no un perfil de acceso. Nomina es un modulo transversal de RH y
Finanzas, no un tipo de usuario.

Permisos tecnicos nuevos:

- `hr.employee.self_view`
- `hr.employee.scope_view`
- `hr.sensitive_personal.view`
- `hr.salary.view` y `hr.salary.manage`
- `hr.medical.view` y `hr.medical.manage`
- `hr.cfdi.self_view`, `hr.cfdi.manage` y `hr.cfdi.audit`
- `payroll.view`, `payroll.manage`, `payroll.operate` y `payroll.approve`
- `hr.documents.download_sensitive`

Administrar la infraestructura no otorgara automaticamente acceso a expedientes
sensibles.

## 12. Documentos y conservacion

Cada tipo documental definira:

- Categoria y nivel de sensibilidad.
- Roles que pueden cargar, consultar y descargar.
- Meses de conservacion activa e inactiva.
- Evento que inicia el plazo: carga, sustitucion o baja del trabajador.
- Bloqueo legal o administrativo.
- Version, checksum, origen y relacion con documento sustituido.

La conservacion se administrara internamente por empresa mediante datos maestros.
Mientras no exista una politica institucional con plazos aprobados, la regla
predeterminada sera conservar y no eliminar fisicamente documentos. La depuracion
futura requerira autorizacion especial, bitacora y un reporte previo de elementos
afectados.

## 13. Notificaciones

Canales por prioridad:

1. Plataforma: obligatorio en P1.
2. Correo electronico: obligatorio en P1, mediante proveedor configurable.
3. Push movil: P4.
4. SMS o WhatsApp: P4 y solo mediante proveedor autorizado.

Cada evento definira destinatario, plantilla, canal, reintentos y escalamiento.
Una falla del correo no revertira la operacion; quedara en una cola con estado y
reintento. Los mensajes no incluiran diagnosticos ni importes sensibles.

El envio de correo no se acoplara a Microsoft, Google ni otro proveedor. Habra una
interfaz de proveedor por empresa con SMTP generico como opcion base y adaptadores
adicionales cuando se necesiten. Cambiar de proveedor no modificara solicitudes,
plantillas ni reglas de notificacion.

## 14. Criterios de aceptacion priorizados

### P0

- Un expediente migrado conserva folio, fotografia, puesto, turno, vacaciones y
  ausencias actuales.
- No se puede consultar otra empresa cambiando un identificador en la URL.
- Un usuario sin permiso de salario, CFDI o salud recibe `403` aunque tenga
  acceso general a RH.
- Toda descarga sensible genera bitacora.
- Las migraciones se ejecutan y revierten en la base de pruebas sin afectar
  produccion.

### P1

- El trabajador solo puede ver y operar sus propios registros.
- El jefe solo ve trabajadores de su alcance y nunca el diagnostico medico.
- Vacaciones calculan dias conforme al turno y calendario correspondiente.
- Los traslapes, saldo insuficiente y periodos bloqueados impiden el envio.
- El Administrador de RH decide con motivo e historial; el jefe no interviene.
- Un permiso sin goce autorizado aparece como incidencia pendiente de prenomina.
- Las notificaciones internas se generan una sola vez por evento.

### P2

- Cada cambio de horario crea una version auditable.
- La comparacion programado-real identifica diferencias configurables.
- Solo incidencias autorizadas llegan a la prenomina.
- Cerrar un periodo congela sus resultados.
- Reabrir requiere permiso y justificacion.
- La exportacion generica coincide con el total visible en el periodo.

### P3

- La carga masiva relaciona XML y PDF con el trabajador correcto.
- Un UUID repetido se rechaza y queda reportado.
- Archivos no relacionados permanecen en una bandeja de pendientes.
- El trabajador descarga unicamente sus CFDI.
- La confirmacion conserva aviso, fecha, sesion y version del comprobante.
- Sustituir un CFDI conserva la relacion con el anterior.

## 15. Pruebas minimas

- Pruebas unitarias de reglas de vacaciones, jerarquia y periodicidad.
- Pruebas de integracion de cada transicion de estado.
- Pruebas negativas de acceso cruzado entre empresas, areas y trabajadores.
- Pruebas de documentos sensibles y bitacora de descarga.
- Pruebas de migracion con datos sinteticos.
- Pruebas de concurrencia para intentos simultaneos, doble clic y cierre de periodo.
- Pruebas responsivas en computadora y telefono.

## 16. Portal del colaborador

Habra una pagina publica general que no requerira usuario ni contrasena. Esta
pagina podra mostrar informacion institucional, ayuda, politicas, acceso al portal
y estado general del servicio, pero no nombres, saldos, horarios, documentos ni
solicitudes de una persona.

El Administrador de RH controlara dos niveles de disponibilidad:

- Interruptor general por empresa para activar o desactivar todo el portal.
- Acceso individual por colaborador para habilitar, suspender o reactivar su cuenta.

Cuando el portal general este desactivado, ninguna sesion podra consultar datos ni
enviar solicitudes, aunque se hubiera iniciado anteriormente. La pagina publica
mostrara solamente que el autoservicio no se encuentra disponible.

Para consultar el expediente propio o crear solicitudes, el colaborador capturara
su ID de trabajo y un PIN personal de exactamente cuatro digitos. El ID por si
solo no se considera secreto ni suficiente para autenticar.

El PIN temporal solicitado por el propietario sera `0000`. Por seguridad, no se
almacenara como PIN normal ni permitira consultar informacion. Funcionara como una
orden de primer acceso bajo estas condiciones:

1. RH debe haber habilitado previamente la cuenta individual.
2. RH abre una ventana temporal de primer acceso con duracion de seis horas.
3. Dentro de esa ventana, el colaborador captura su ID y `0000`.
4. El sistema muestra unicamente la pantalla para crear y confirmar otro PIN.
5. Hasta guardar el nuevo PIN no se crea sesion ni se muestra ningun dato.
6. Al completar el cambio o vencer la ventana, `0000` deja de ser valido.

Este flujo tambien se aplicara al reinicio solicitado por el colaborador. El
Administrador de RH puede iniciar el reinicio, pero no ver ni elegir el PIN final.
El reinicio revoca todas las sesiones existentes y abre una nueva ventana temporal.

Controles obligatorios del PIN:

- Se almacena solamente como hash con sal; nunca como texto recuperable.
- Cinco intentos fallidos bloquean temporalmente la cuenta y generan bitacora.
- Se limita la frecuencia de intentos por cuenta y direccion IP.
- Los mensajes de error no confirman si un ID laboral existe.
- Las descargas sensibles requieren una autenticacion reciente.
- Todas las sesiones se revocan al reiniciar el PIN.

Permisos de autoservicio administrables por RH:

- Consultar expediente propio.
- Consultar calendario y saldo de vacaciones.
- Solicitar vacaciones.
- Solicitar permisos con goce o sin goce.
- Reportar incapacidad y adjuntar documentos.
- Consultar CFDI, salario o documentos sensibles cuando el rol lo permita.

Desactivar una capacidad no elimina solicitudes ni documentos anteriores.

Despues de autenticar, la sesion quedara limitada al `employee_id` vinculado. No
se aceptara un ID recibido desde el navegador para decidir que expediente mostrar
sin compararlo con la identidad de la sesion.

## 17. Proteccion confirmada del PIN temporal

El PIN `0000` se acepta solamente durante la ventana de seis horas habilitada por
RH y nunca da acceso directo a datos. No se implementara `ID + 0000` como
credencial permanente o disponible sin activacion previa.

## 18. Decisiones confirmadas

- Empresas y unidades organizacionales configurables, con baja logica.
- Autorizacion final de vacaciones exclusiva del Administrador de RH.
- Nomina es un modulo transversal de Recursos Humanos y Finanzas, no un perfil
  de usuario, y no aprueba vacaciones.
- Periodicidad de nomina administrable como dato maestro de RH.
- Plantilla estandar ABICORP y perfiles de exportacion propios por empresa.
- Matriz propuesta de acceso a salario, CFDI y documentos medicos aceptada.
- Alertas dentro de la plataforma y por correo electronico.
- Conservacion administrada internamente y sin eliminacion fisica por defecto.
- Portal publico general y autoservicio individual protegido por segundo factor.
- Ciclos vacacionales de un anio con avisos a tres meses y un mes del vencimiento.
- Adelanto sin limite fijo, siempre sujeto a decision del Administrador de RH.
- Jefe inmediato fuera del flujo de autorizacion; RH administra todo el proceso.
- Campos fiscales, laborales y organizacionales obligatorios al registrar o
  activar al colaborador.
- Catalogos y solicitudes relacionados por ID interno, sin folio visible
  obligatorio.
- Portal por ID laboral y PIN de cuatro digitos, con activacion y reinicio seguro.
- Correo desacoplado de proveedores especificos.
- Portal activable por empresa y por colaborador desde RH.
- RH puede asignar capacidades individuales de autoservicio.
- RH puede registrar permisos, vacaciones y ajustes de saldo directamente con
  motivo, notificacion y bitacora.
- Ventana de seis horas para primer acceso o reinicio mediante PIN temporal
  `0000`, con cambio obligatorio antes de crear sesion.

## 19. Fuera de alcance inmediato

- Calculo monetario de nomina y timbrado fiscal.
- Diagnostico medico o decisiones clinicas.
- Reloj checador o biometrico.
- Aplicaciones nativas Android/iOS.
- Integraciones directas con terceros sin especificacion y credenciales.

## 20. Estado de implementacion del paso 4

Implementado primero en PostgreSQL de pruebas mediante las migraciones 28 y 29:

- Datos personales, fecha de nacimiento y domicilio en tabla propia.
- CURP, RFC y NSS en la seccion fiscal ya separada.
- Empresa, centro, departamento, area, puesto y responsable organizacional.
- Contrato, periodicidad de nomina, fecha y motivo de baja.
- Salario en almacenamiento privado y fuera de vistas sin permiso especial.
- Catalogo documental con sensibilidad general, fiscal, salarial, CFDI y medica.
- Fechas de emision y vencimiento, versiones relacionadas y documento vigente.
- Bitacora de consulta y descarga con usuario, fecha e IP.
- Retiro logico de archivos; el contenido y la trazabilidad no se destruyen.
- Calculo de integridad del expediente y alertas por faltantes o vencimiento a
  noventa dias.

Pendiente de un paso posterior: estados formales `draft` e `incomplete`, reglas
configurables por empresa para activar un expediente y conservacion automatica
por tipo documental.
