# ABICORP ERP

## Manual operativo y checklist de revisión funcional SMETA

Versión del ERP: Beta 1.2  
Versión del manual: 2.0  
Fecha de emisión: 1 de septiembre de 2026  
Documento de referencia: `checklist_erp_rh_smeta_revision.pdf`  
Ambiente recomendado: Pruebas

Derechos Reservados Fimma.

> Este documento sirve para operar y revisar ABICorp. No sustituye una auditoría SMETA, la legislación aplicable ni el criterio de un auditor acreditado. Una función visible no equivale por sí sola a cumplimiento.

## 1. Objetivo y regla de cierre

El manual tiene tres objetivos:

1. Explicar el recorrido normal del Gestor, ERP y Portal del colaborador.
2. Definir qué evidencia debe conservarse al probar cada función.
3. Comparar la cobertura actual de ABICorp con las 27 áreas del checklist SMETA.

Una prueba sólo puede marcarse `OK` cuando:

- [ ] Se ejecutó de principio a fin en la base de pruebas.
- [ ] Se probó con un dato válido y con al menos un dato inválido.
- [ ] El perfil autorizado pudo operar y el perfil no autorizado fue limitado.
- [ ] Se generó un folio, historial, archivo, captura o registro de bitácora.
- [ ] La información permaneció después de cerrar sesión e ingresar de nuevo.
- [ ] El resultado fue revisado por el responsable funcional.

Estados de revisión:

| Estado | Uso |
| --- | --- |
| NI | No iniciado. |
| ED | En desarrollo. No debe aceptarse como terminado. |
| PR | Disponible en pruebas, pendiente de aceptación. |
| OK | Probado, con permisos, evidencia y trazabilidad. |
| MI | Funciona, pero requiere una mejora documentada. |
| NA | No aplica; debe registrarse la justificación. |

Cobertura actual del producto:

| Cobertura | Significado |
| --- | --- |
| Disponible | Existe un flujo operativo que puede probarse ahora. |
| Parcial | ABICorp cubre una parte; requiere evidencia externa o desarrollo adicional. |
| Pendiente | No existe todavía un flujo dedicado suficiente. |

## 2. Ambientes y accesos

No combine producción y pruebas. El Gestor y el ERP deben usar la misma base PostgreSQL y el mismo ambiente.

| Aplicación | Pruebas | Uso |
| --- | --- | --- |
| Centro de Gestión | `http://127.0.0.1:5151` | Empresas, planes, suscripciones, identidades y módulos. |
| ERP operativo | `http://127.0.0.1:5150` | Operación administrativa, industrial, RH y cumplimiento. |
| Portal del colaborador | `http://127.0.0.1:5150/portal` | Expediente propio, horarios, solicitudes, documentos y CFDI autorizados. |

Comandos desde PowerShell, ubicándose en la carpeta de ABICorp:

```powershell
.\INICIAR_AMBIENTE_PRUEBAS.cmd
```

Para detener únicamente el ambiente de pruebas:

```powershell
.\DETENER_AMBIENTE_PRUEBAS.cmd
```

Comprobación inicial:

- [ ] El Gestor abre sin `Failed to fetch`.
- [ ] El ERP muestra la empresa seleccionada.
- [ ] La fecha y hora corresponden a la zona configurada.
- [ ] Producción, Calidad, Mantenimiento, Logística, Compras y Tareas abren sin error interno.
- [ ] El Portal abre y muestra la identidad de la empresa.

## 3. Empresa demo para revisión

Desde el Centro de Gestión puede precargarse **Nova Manufactura Demo**, una empresa mediana con información ficticia. La duración permitida es de 12, 24 o 72 horas y la suspensión se calcula automáticamente.

Acceso principal de la demo:

| Dato | Valor |
| --- | --- |
| Empresa | Nova Manufactura Demo |
| Identificador local | `nova-manufactura-demo` |
| Usuario | `demo.admin` |
| Contraseña temporal de demostración | `Demo2026!` |
| Perfil | Administrador, nivel 4 |

La demo incluye áreas, centros, departamentos, puestos, 30 colaboradores ficticios, almacenes, artículos, clientes, proveedores y registros operativos. No use nombres, documentos, correos, salarios ni cuentas reales durante la revisión.

Checklist de precarga:

- [ ] Crear la demo desde **Centro de Gestión > Empresas y accesos > Precargar empresa demo**.
- [ ] Seleccionar 12, 24 o 72 horas.
- [ ] Guardar la fecha y hora de expiración como evidencia.
- [ ] Ingresar al ERP con `demo.admin`.
- [ ] Confirmar que Recursos Humanos muestra 30 expedientes ficticios.
- [ ] Confirmar que los módulos autorizados aparecen en el menú.
- [ ] Verificar que la demo no modificó otras empresas.

## 4. Perfiles, niveles y permisos sensibles

Perfiles globales del Gestor:

| Perfil | Nivel de módulos | Uso recomendado |
| --- | --- | --- |
| Administrador | 4 | Configura, administra, aprueba y cierra. |
| Auxiliar | 2 o 3 | Nivel 2 para captura; nivel 3 para revisión y aprobación. |
| Auditor | 1 | Consulta sin modificar datos. |

Los permisos **Salarios**, **CFDI** y **Documentos médicos** se asignan individualmente. No deben heredarse sólo por seleccionar un preset.

Presets disponibles: Administración, Recursos Humanos, Producción, Mantenimiento, Gestión, Ambiental y Personalizada.

Prueba mínima de segregación:

- [ ] Administrador crea y aprueba un registro de prueba.
- [ ] Auxiliar nivel 2 puede capturar, pero no aprobar ni cerrar.
- [ ] Auxiliar nivel 3 puede revisar sólo donde el módulo lo permite.
- [ ] Auditor puede consultar, pero no aparecen acciones de guardado.
- [ ] Desactivar Salarios oculta importes privados.
- [ ] Desactivar CFDI impide abrir o descargar recibos.
- [ ] Desactivar Documentos médicos protege certificados e información clínica.
- [ ] Cada intento denegado devuelve un mensaje comprensible y no cambia datos.

## 5. Flujo operativo recomendado

### 5.1 Centro de Gestión

1. Crear o seleccionar un plan de suscripción.
2. Crear la empresa; el código y las fechas se calculan automáticamente.
3. Confirmar la suscripción asignada. Los cobros en línea no forman parte de esta versión.
4. Crear identidades y seleccionar perfil, preset y niveles.
5. Activar permisos sensibles sólo con autorización documentada.
6. Suspender una empresa antes de eliminarla cuando el caso permita conservación.
7. Para eliminar, usar la confirmación escrita y guardar evidencia del impacto.

Checklist:

- [ ] Existe un plan activo y documentado.
- [ ] La empresa tiene razón social, nombre comercial, estado y suscripción correctos.
- [ ] No se muestran formularios de cobros o pasarelas de pago.
- [ ] Cada identidad tiene únicamente los módulos necesarios.
- [ ] El cierre de sesión solicita confirmación.

### 5.2 Estructura organizacional

Ruta: **Datos maestros > Estructura** y **Recursos Humanos > Catálogos > Estructura organizacional**.

Orden recomendado:

1. Empresa.
2. Centro de trabajo.
3. Departamento.
4. Área funcional.
5. Puesto.
6. Turno.
7. Plan de vacaciones.

- [ ] Los códigos son únicos.
- [ ] El centro pertenece a la empresa correcta.
- [ ] El departamento pertenece a la empresa y centro correctos.
- [ ] Desactivar un registro evita nuevas asignaciones sin borrar el histórico.
- [ ] La estructura se consulta desde RH, Nómina y Seguridad.

### 5.3 Alta y mantenimiento del expediente

Ruta: **Recursos Humanos > Gestión de personal**.

1. Usar **Nuevo personal** para una alta individual o **Carga masiva** para un lote.
2. Capturar identidad, información laboral, adscripción, contrato, nómina y contacto de emergencia.
3. Revisar la tarjeta de integridad y completar los faltantes.
4. Guardar el folio laboral generado automáticamente.
5. Para una carga masiva, validar todo el archivo antes de confirmar. Un lote con errores no debe crear altas parciales.

- [ ] Número laboral único.
- [ ] CURP, RFC y NSS ficticios en pruebas.
- [ ] Empresa, centro, departamento, área y puesto correctos.
- [ ] Salario visible sólo con permiso.
- [ ] Edición conservada en bitácora.
- [ ] Baja lógica: el expediente queda inactivo y conserva historial.

### 5.4 Portal del colaborador

Administración: **Recursos Humanos > Portal colaboradores**.  
Acceso: `http://127.0.0.1:5150/portal`.

1. Activar el portal general y el acceso del colaborador.
2. Entregar PIN temporal por un canal controlado.
3. El colaborador cambia el PIN en su primer acceso.
4. Probar expediente propio, horarios, solicitudes, documentos y CFDI autorizados.
5. Restablecer el PIN sólo cuando exista una solicitud validada.

- [ ] Un colaborador no consulta expedientes de terceros.
- [ ] El PIN temporal expira según la política.
- [ ] Bloquear el acceso revoca el uso posterior.
- [ ] Las descargas y solicitudes quedan auditadas.

### 5.5 Horarios y asistencia

Ruta: **Recursos Humanos > Visualizar horarios**.

1. Crear periodo semanal.
2. Aplicar turno predeterminado, copiar semana anterior o importar.
3. Revisar traslapes y publicar una versión.
4. Capturar o importar horario real.
5. Comparar programado contra real.
6. Solicitar una corrección y aprobarla con motivo.

- [ ] La versión publicada no cambia silenciosamente.
- [ ] La corrección conserva valor anterior, nuevo, solicitante, aprobador y motivo.
- [ ] Vacaciones, permisos, incapacidades y festivos aparecen en el calendario automático.
- [ ] Las incidencias autorizadas llegan a prenómina cuando corresponde.

### 5.6 Vacaciones, permisos e incapacidades

Ruta administrativa: **Recursos Humanos > Gestión de personal**.  
Ruta del trabajador: **Portal > Nueva solicitud**.

1. Seleccionar tipo, subtipo, fechas y motivo.
2. Revisar días hábiles, saldo, traslapes, anticipación y cobertura.
3. Enviar al jefe de área cuando la política lo requiera.
4. Autorizar o rechazar en RH con comentario.
5. Imprimir el comprobante y conservar el folio.

- [ ] El saldo no se descuenta definitivamente antes de aprobar.
- [ ] Un permiso sin goce genera incidencia de prenómina.
- [ ] Una incapacidad puede relacionarse con Seguridad y Salud.
- [ ] Los datos médicos se ocultan sin permiso sensible.
- [ ] Cancelar revierte los efectos correspondientes y conserva historial.

### 5.7 Nómina y CFDI

Ruta: **Recursos Humanos > Nómina y CFDI**.

1. Crear el periodo.
2. Generar prenómina desde salarios e incidencias autorizadas.
3. Revisar percepciones, deducciones y neto por colaborador.
4. Corregir antes de finalizar.
5. Importar XML CFDI 4.0 con complemento de nómina 1.2 y, si aplica, su PDF.
6. Resolver asociaciones ambiguas y UUID duplicados.
7. Finalizar y conservar la exportación y bitácora.

- [ ] Un periodo finalizado no se modifica sin reapertura autorizada.
- [ ] XML y PDF privados usan almacenamiento configurado; PostgreSQL conserva metadatos.
- [ ] El colaborador sólo consulta sus recibos.
- [ ] Cada descarga queda auditada.

### 5.8 Seguridad, Salud y Cumplimiento

Rutas: **Seguridad y Salud** y **Recursos Humanos > Cumplimiento**.

1. Registrar incidente o accidente.
2. Registrar incapacidad vinculada cuando exista.
3. Evaluar peligro, probabilidad, consecuencia y controles.
4. Asignar responsable y fecha de revisión.
5. Registrar requisito de cumplimiento y evidencia.
6. En casos confidenciales, registrar queja, severidad, investigador, historial y evidencia.

- [ ] El caso confidencial recibe folio.
- [ ] Un reporte anónimo no conserva identidad ni contacto innecesario.
- [ ] Sólo usuarios autorizados consultan el canal confidencial.
- [ ] Resolver o cerrar exige comentario y conserva historial.
- [ ] El tablero coincide con los registros fuente.

### 5.9 Bitácora y paquete de evidencia

Ruta: **Configuración > Bitácora**.

Para cada prueba guarde:

- Captura antes y después.
- Folio o identificador.
- Usuario y perfil utilizado.
- Fecha y hora.
- Resultado esperado y resultado real.
- Archivo descargado, cuando exista.
- Registro de bitácora asociado.
- Captura del intento denegado con un perfil sin permiso.

Convención de nombre:

`SMETA-RH-10-07_VAC-000001_comprobante_2026-09-01.pdf`

## 6. Checklist transversal antes de revisar SMETA

| ID | Comprobación | Estado | Evidencia |
| --- | --- | --- | --- |
| GEN-01 | Usar exclusivamente la base de pruebas. | | |
| GEN-02 | Registrar versión Beta 1.2, fecha y responsable. | | |
| GEN-03 | Confirmar aislamiento entre dos empresas. | | |
| GEN-04 | Confirmar perfiles Administrador, Auxiliar y Auditor. | | |
| GEN-05 | Probar permisos sensibles por separado. | | |
| GEN-06 | Probar dato obligatorio vacío y duplicado. | | |
| GEN-07 | Probar doble clic en Guardar/Aprobar. | | |
| GEN-08 | Confirmar folio automático e irrepetible. | | |
| GEN-09 | Confirmar trazabilidad en Bitácora. | | |
| GEN-10 | Cerrar sesión y comprobar persistencia. | | |
| GEN-11 | Probar revocación, suspensión o baja. | | |
| GEN-12 | Guardar evidencia negativa de acceso. | | |
| GEN-13 | Confirmar respaldo y restauración en ambiente separado. | | |
| GEN-14 | Registrar hallazgos y fecha objetivo. | | |

## 7. Matriz de revisión SMETA por área

La cobertura indicada es la línea base funcional de ABICorp Beta 1.2. El revisor debe escribir `NI`, `ED`, `PR`, `OK`, `MI` o `NA` en cada bloque.

### 01. Configuración de empresa - Prioridad alta - Cobertura parcial

Ruta: **Centro de Gestión**, **Configuración** y **Datos maestros > Estructura**.

- [ ] Comparar identidad legal, centro, domicilio y zona horaria.
- [ ] Validar responsables de RH, Seguridad y Cumplimiento.
- [ ] Revisar calendarios y festivos.
- [ ] Documentar externamente salario mínimo, salario digno y prestaciones no parametrizadas.

Estado: ______  Evidencia: ______________________________________________

### 02. Áreas y estructura organizacional - Prioridad alta - Cobertura parcial

- [ ] Crear empresa, centro, departamento y área.
- [ ] Probar jerarquía y desactivación sin pérdida histórica.
- [ ] Validar responsables y puestos relacionados.
- [ ] Registrar como mejora la plantilla autorizada y control formal de plazas.

Estado: ______  Evidencia: ______________________________________________

### 03. Puestos y perfiles de puesto - Prioridad alta - Cobertura parcial

- [ ] Crear puesto con código, nombre y descripción.
- [ ] Relacionar área y ocupantes.
- [ ] Conservar fuera del ERP, mientras se desarrolla, el perfil detallado, competencias, riesgos, EPP, versión y firmas.
- [ ] No marcar `OK` si sólo existe el nombre del puesto.

Estado: ______  Evidencia: ______________________________________________

### 04. Reclutamiento responsable - Prioridad alta - Cobertura pendiente

- [ ] Confirmar que no existe todavía un flujo dedicado de vacantes y candidatos.
- [ ] Conservar autorización de vacante, oferta, agencia, cuotas y motivo de rechazo en evidencia externa controlada.
- [ ] Registrar el desarrollo requerido antes de declarar cobertura SMETA.

Estado: ______  Evidencia: ______________________________________________

### 05. Registro del colaborador - Prioridad crítica - Cobertura disponible

- [ ] Probar alta individual y carga masiva.
- [ ] Validar identidad, adscripción, contrato, salario y contacto de emergencia.
- [ ] Probar duplicados, expediente incompleto y activación.
- [ ] Confirmar que el folio y la bitácora se conservan.

Estado: ______  Evidencia: ______________________________________________

### 06. Contratos y empleo regular - Prioridad alta - Cobertura parcial

- [ ] Registrar tipo, número, inicio, fin y periodicidad de nómina.
- [ ] Cargar contrato y acuse como documentos protegidos.
- [ ] Verificar vigencia y alerta manual.
- [ ] Registrar como mejora plantillas, firma, idioma, versiones y convenio modificatorio automático.

Estado: ______  Evidencia: ______________________________________________

### 07. Empleo libremente elegido - Prioridad crítica - Cobertura parcial

- [ ] Usar Cumplimiento para reportes confidenciales o anónimos de coerción.
- [ ] Conservar historial e investigador autorizado.
- [ ] Documentar externamente declaraciones de voluntariedad, originales, depósitos, deudas y consentimiento de horas extra.
- [ ] Probar protección de identidad y no represalias.

Estado: ______  Evidencia: ______________________________________________

### 08. Jornada, turnos y asistencia - Prioridad crítica - Cobertura disponible

- [ ] Crear turno y periodo semanal.
- [ ] Publicar horario programado y capturar horario real.
- [ ] Probar corrección autorizada y versionada.
- [ ] Verificar ausencias, festivos y envío de incidencias.

Estado: ______  Evidencia: ______________________________________________

### 09. Horas extra - Prioridad crítica - Cobertura parcial

- [ ] Revisar diferencias entre horario programado y real.
- [ ] Documentar autorización y consentimiento fuera del ERP cuando sea necesario.
- [ ] Confirmar el tratamiento de la incidencia en prenómina.
- [ ] Registrar como mejora límites legales, recurrencia, tarifa y comparación pagada/trabajada dedicada.

Estado: ______  Evidencia: ______________________________________________

### 10. Vacaciones - Prioridad alta - Cobertura disponible

- [ ] Probar plan, saldo, solicitud, traslape y cobertura.
- [ ] Probar aprobación, rechazo, cancelación y vacaciones adelantadas.
- [ ] Confirmar calendario, historial y comprobante impreso.
- [ ] Verificar efecto económico aplicable en prenómina.

Estado: ______  Evidencia: ______________________________________________

### 11. Permisos e incapacidades - Prioridad alta - Cobertura disponible

- [ ] Probar permiso con y sin goce.
- [ ] Probar incapacidad con certificado y vínculo a Seguridad.
- [ ] Confirmar calendario y prenómina.
- [ ] Negar documentos médicos a un usuario sin permiso.

Estado: ______  Evidencia: ______________________________________________

### 12. Nómina y pagos - Prioridad crítica - Cobertura parcial

- [ ] Crear periodo y prenómina.
- [ ] Revisar percepciones, deducciones y neto.
- [ ] Importar CFDI, detectar UUID repetido y asociación ambigua.
- [ ] Conservar por separado evidencia bancaria, fecha efectiva de pago y controles legales aún no automatizados.

Estado: ______  Evidencia: ______________________________________________

### 13. Riesgos laborales - Prioridad crítica - Cobertura disponible

- [ ] Registrar peligro, tipo de riesgo, probabilidad y consecuencia.
- [ ] Asignar controles, responsable y revisión.
- [ ] Probar tratamiento y estado.
- [ ] Vincular la evidencia con área, actividad e incidente cuando aplique.

Estado: ______  Evidencia: ______________________________________________

### 14. Equipo de protección personal - Prioridad alta - Cobertura parcial

- [ ] Registrar requisitos relacionados en Seguridad y Cumplimiento.
- [ ] Conservar evidencia de entrega, talla, lote, reposición y firma fuera del ERP.
- [ ] Verificar que el puesto y riesgo indiquen el EPP requerido en la documentación de auditoría.
- [ ] Registrar como mejora el inventario y acuse individual de EPP.

Estado: ______  Evidencia: ______________________________________________

### 15. Capacitación y competencias - Prioridad alta - Cobertura pendiente

- [ ] Conservar matriz de competencias, cursos, evaluaciones, vencimientos y constancias en evidencia externa.
- [ ] Relacionar documentos disponibles con expediente y puesto.
- [ ] Registrar módulo requerido para plan, asistencia, evaluación y alertas.

Estado: ______  Evidencia: ______________________________________________

### 16. Evaluaciones y movimientos - Prioridad media - Cobertura parcial

- [ ] Probar edición de puesto, área, jefe y salario con bitácora.
- [ ] Conservar autorización externa del movimiento.
- [ ] Registrar como mejora evaluaciones, objetivos, calibración, plan de desarrollo y aceptación del colaborador.

Estado: ______  Evidencia: ______________________________________________

### 17. Libertad de asociación - Prioridad media - Cobertura parcial

- [ ] Revisar el campo de condición sindical con acceso restringido.
- [ ] Conservar representantes, acuerdos, reuniones y no interferencia en evidencia protegida.
- [ ] Probar que un auditor no modifica ni expone datos sensibles.

Estado: ______  Evidencia: ______________________________________________

### 18. Quejas, acoso y no represalias - Prioridad crítica - Cobertura disponible

- [ ] Crear caso anónimo y caso identificado.
- [ ] Definir severidad, confidencialidad, investigador y fecha objetivo.
- [ ] Agregar historial y evidencia.
- [ ] Resolver, cerrar y verificar que sólo usuarios autorizados consulten el caso.

Estado: ______  Evidencia: ______________________________________________

### 19. Medidas disciplinarias - Prioridad media - Cobertura pendiente

- [ ] Conservar política, hechos, evidencia, descargo, aprobación y apelación externamente.
- [ ] No usar sólo notas libres del expediente como control disciplinario.
- [ ] Registrar desarrollo requerido para catálogo, flujo, firmas y revisión de consistencia.

Estado: ______  Evidencia: ______________________________________________

### 20. Accidentes e incidentes - Prioridad crítica - Cobertura disponible

- [ ] Registrar evento, persona, fecha, área, tipo y descripción.
- [ ] Investigar y documentar causa raíz.
- [ ] Vincular incapacidad, riesgo y acción correctiva.
- [ ] Cerrar y comparar indicadores contra los registros fuente.

Estado: ______  Evidencia: ______________________________________________

### 21. Personal tercerizado - Prioridad alta - Cobertura parcial

- [ ] Identificar tipo de contratación y proveedor/agencia en documentos controlados.
- [ ] Verificar contrato, jornada, salario, seguridad social, capacitación y aptitud.
- [ ] Controlar vigencias externamente.
- [ ] Registrar como mejora el catálogo y evaluación formal de agencias y trabajadores asignados.

Estado: ______  Evidencia: ______________________________________________

### 22. Baja y finiquito - Prioridad alta - Cobertura parcial

- [ ] Registrar baja, motivo y fecha.
- [ ] Confirmar conservación del expediente e historial.
- [ ] Revocar accesos y sesiones relacionados.
- [ ] Conservar cálculo, autorización, pago, documentos y entrevista de salida fuera del ERP mientras se desarrolla el finiquito integral.

Estado: ______  Evidencia: ______________________________________________

### 23. Gestión documental - Prioridad alta - Cobertura parcial

- [ ] Cargar documento con categoría y relación al registro.
- [ ] Probar permisos de salario, CFDI y médico.
- [ ] Confirmar auditoría de carga y descarga.
- [ ] Registrar como mejora versiones, firma, acuse, retención y paquete automático de auditoría cuando no estén disponibles.

Estado: ______  Evidencia: ______________________________________________

### 24. Auditorías SMETA - Prioridad crítica - Cobertura parcial

- [ ] Usar este checklist para definir alcance, centro, periodo y muestra.
- [ ] Relacionar folios y archivos con cada prueba.
- [ ] Proteger entrevistas y casos confidenciales.
- [ ] Registrar como mejora el expediente de auditoría, muestreo reproducible y reporte automático dentro de ABICorp.

Estado: ______  Evidencia: ______________________________________________

### 25. Hallazgos y acciones correctivas CAPA - Prioridad crítica - Cobertura parcial

- [ ] Usar Tareas y Aprobaciones para responsable y fecha compromiso.
- [ ] Usar Calidad para acciones correctivas de procesos industriales.
- [ ] Conservar origen SMETA, requisito, contención, causa raíz, evidencia y eficacia.
- [ ] Registrar como mejora el vínculo directo Auditoría SMETA - Hallazgo - CAPA.

Estado: ______  Evidencia: ______________________________________________

### 26. Seguridad, permisos y trazabilidad - Prioridad crítica - Cobertura disponible

- [ ] Probar Administrador, Auxiliar y Auditor.
- [ ] Probar permisos sensibles por separado.
- [ ] Revisar bitácora después de alta, edición, aprobación, descarga y baja.
- [ ] Verificar aislamiento entre empresas y restauración de respaldo.

Estado: ______  Evidencia: ______________________________________________

### 27. Tablero de cumplimiento - Prioridad media - Cobertura parcial

- [ ] Revisar Pulso de Recursos Humanos y alertas de expedientes.
- [ ] Revisar indicadores de Seguridad y Salud.
- [ ] Abrir cada alerta y comprobar el registro fuente.
- [ ] Registrar como mejora indicadores dedicados para horas extra, EPP, capacitación, agencias, auditorías y CAPA.

Estado: ______  Evidencia: ______________________________________________

## 8. Resumen de cobertura funcional Beta 1.2

| Cobertura | Áreas |
| --- | --- |
| Disponible | 05, 08, 10, 11, 13, 18, 20 y 26 |
| Parcial | 01, 02, 03, 06, 07, 09, 12, 14, 16, 17, 21, 22, 23, 24, 25 y 27 |
| Pendiente | 04, 15 y 19 |

Esta clasificación es una evaluación funcional del sistema, no un resultado de auditoría social.

## 9. Registro de hallazgos y evidencias

| No. | ID SMETA | Hallazgo | Riesgo | Responsable | Fecha objetivo | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |

| ID SMETA | Folio/registro | Archivo o captura | Ubicación | Revisor | Fecha |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
| | | | | | |
| | | | | | |

## 10. Cierre de la revisión

| Resultado | Cantidad |
| --- | ---: |
| NI | |
| ED | |
| PR | |
| OK | |
| MI | |
| NA | |
| Total | |

Firmas o referencias de aprobación:

| Rol | Nombre | Resultado | Fecha | Firma/referencia |
| --- | --- | --- | --- | --- |
| Administrador de RH | | | | |
| Seguridad/Cumplimiento | | | | |
| Responsable técnico | | | | |
| Dirección del centro | | | | |

## 11. Diagnóstico rápido

| Mensaje o situación | Revisión |
| --- | --- |
| `Failed to fetch` | Confirmar que el servidor del mismo ambiente está activo y que PostgreSQL responde. |
| `Ocurrió un error interno` | Guardar módulo, hora y usuario; revisar el log del ERP de pruebas antes de repetir. |
| Módulo no visible | Revisar perfil, preset, nivel y estado de la identidad en el Gestor. |
| No aparecen empresas o centros | Confirmar que se está usando la empresa y base correctas y que la estructura está activa. |
| Salario, CFDI o médico oculto | Revisar el permiso sensible individual; no elevar todo el perfil sin autorización. |
| Portal bloqueado | Revisar configuración general, acceso individual, PIN y expiración. |
| Solicitud no avanza | Revisar jefe de área, política de aprobación y permisos del Administrador RH. |
| Documento no se puede guardar | Verificar almacenamiento privado y clasificación del archivo. |

## 12. Regla final de liberación

No trasladar una función a producción sólo porque se vea correctamente o tenga estado `PR`. Debe existir evidencia positiva y negativa, permisos probados, trazabilidad, respaldo y aceptación del responsable funcional. Los datos sintéticos y archivos de la demo no deben copiarse a producción.
