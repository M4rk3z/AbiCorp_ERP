# ABICORP ERP - Guia de verificacion funcional RH / SMETA

Version de la guia: 1.0  
Fecha base: 2026-08-19  
Documento de referencia: `checklist_erp_rh_smeta_revision.pdf`  
Ambiente obligatorio: **Pruebas**

## 1. Objetivo

Esta guia permite comprobar, punto por punto, las funciones de Recursos Humanos
solicitadas en el checklist de preparacion SMETA. Conserva los identificadores
`RH-01-01` a `RH-27-10` para que los resultados puedan compararse con el
documento original.

Una pantalla visible no significa que el requisito este terminado. Solo marque
`OK` cuando la funcion:

1. Puede ejecutarse de principio a fin.
2. Valida datos incorrectos y evita duplicados.
3. Respeta empresa, centro, perfil y permisos sensibles.
4. Genera una evidencia consultable o descargable.
5. Conserva usuario, fecha, accion y valores anteriores cuando corresponde.

## 2. Datos de la revision

| Dato | Valor |
| --- | --- |
| Empresa | |
| Centro de trabajo | |
| Responsable | |
| Fecha | |
| Version del ERP | |
| Rama o commit | |
| Base de pruebas | `abicorp-rh-test` |

## 3. Estados permitidos

| Estado | Significado |
| --- | --- |
| `NI` | No iniciado o sin pantalla/ruta funcional |
| `ED` | En desarrollo; no debe probarse como terminado |
| `PR` | Implementado en pruebas, pendiente de aceptacion |
| `OK` | Cumple el criterio de cierre completo |
| `MI` | Funciona, pero requiere una mejora documentada |
| `NA` | No aplica a la empresa; exige justificacion |

En la columna **Estado** escriba una sola clave. En **Evidencia / observacion**
anote capturas, folios, archivos descargados, errores y correcciones necesarias.

## 4. Rutas del ambiente de pruebas

| Aplicacion | Ruta |
| --- | --- |
| ERP | `http://127.0.0.1:5150/` |
| Centro de Gestion | `http://127.0.0.1:5151/` |
| Portal del colaborador | `http://127.0.0.1:5150/portal` |

Recorridos principales dentro del ERP:

- **Configuracion**: datos generales del entorno.
- **Datos maestros**: estructura, areas, puestos y datos compartidos habilitados.
- **Recursos humanos > Gestion de personal**: expedientes, solicitudes,
  horarios, portal, catalogos y cumplimiento.
- **Recursos humanos > Nomina y CFDI**: periodos, prenomina y recibos.
- **Nucleo > Archivos y documentos**: documentos generales y sensibles.
- **Nucleo > Bitacora**: evidencia de acciones del sistema.
- **Seguridad y salud**: riesgos, EPP, incapacidades y accidentes.

## 5. Preparacion de la prueba

- [ ] Iniciar ERP y Gestor de pruebas; no utilizar produccion.
- [ ] Confirmar que el ERP muestre los datos sinteticos esperados.
- [ ] Crear o identificar una empresa, un centro, dos departamentos y dos areas.
- [ ] Tener al menos tres colaboradores ficticios: activo, temporal y contratista.
- [ ] Tener cuentas de Administrador RH, Auxiliar RH y Colaborador.
- [ ] Verificar que cada cuenta tenga solamente los modulos y alcances requeridos.
- [ ] Usar documentos, CURP, RFC, NSS, correos y cuentas bancarias ficticias.
- [ ] Anotar el commit o version antes de comenzar.

## 6. Pruebas transversales obligatorias

Ejecute estas comprobaciones en cada bloque antes de marcarlo `OK`:

- [ ] **Aislamiento:** un usuario de otra empresa no puede consultar el registro.
- [ ] **Minimo privilegio:** Auxiliar RH y Colaborador reciben `403` o una vista
  limitada cuando no tienen el permiso sensible.
- [ ] **Doble clic:** Guardar, aprobar o cerrar dos veces no duplica registros.
- [ ] **Validacion:** datos obligatorios vacios muestran un mensaje comprensible.
- [ ] **Trazabilidad:** la Bitacora conserva usuario, fecha, accion y registro.
- [ ] **Historial:** editar no elimina el valor o documento anterior cuando el
  requisito exige versionado.
- [ ] **Sesion:** una cuenta bloqueada o cerrada no puede seguir operando.
- [ ] **Responsive:** la funcion puede utilizarse en computadora y telefono.

---

## 01. Configuracion de empresa - Prioridad alta

Ruta base: **Configuracion** y **Datos maestros > Estructura organizacional**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-01-01 | Comparar razon social, nombre comercial y RFC con la empresa definida en el Gestor; revisar domicilio y representante. | Una sola identidad empresarial, sin registros duplicados; captura de la ficha. | | |
| RH-01-02 | Crear y editar un centro de trabajo con domicilio y registro patronal. | El centro queda relacionado con la empresa y aparece en expedientes y alcances. | | |
| RH-01-03 | Asignar responsables de RH, Seguridad y Cumplimiento. | Cada responsable ve solo su alcance y queda registrado en bitacora. | | |
| RH-01-04 | Configurar zona horaria, calendario, dias festivos y jornada maxima. | Fechas y horas usan la zona configurada; festivos afectan calendarios. | | |
| RH-01-05 | Cambiar reglas de horas extra, vacaciones, prestaciones y salario minimo. | Las reglas se aplican a nuevos calculos y conservan vigencia. | | |
| RH-01-06 | Registrar referente de salario digno y modificarlo. | Se conserva el valor anterior, responsable y fecha de vigencia. | | |

## 02. Areas y estructura organizacional - Prioridad alta

Ruta base: **Datos maestros > Estructura organizacional** y **RH > Catalogos**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-02-01 | Crear dos areas/subareas y comprobar codigo unico. | No permite codigo duplicado y ambas aparecen en el expediente. | | |
| RH-02-02 | Relacionar un area con empresa y centro. | El area solo se ofrece dentro del alcance correspondiente. | | |
| RH-02-03 | Asignar responsable, area padre y puestos autorizados. | La jerarquia y puestos se muestran correctamente. | | |
| RH-02-04 | Definir plantilla autorizada y ocupar/liberar plazas. | Se calculan plazas ocupadas y vacantes sin conteos negativos. | | |
| RH-02-05 | Abrir el organigrama y listado de responsables. | La jerarquia empresa-centro-departamento-area-responsable es navegable. | | |
| RH-02-06 | Desactivar un area con historial. | Deja de ofrecerse en altas nuevas, pero permanece en expedientes historicos. | | |

## 03. Puestos y perfiles de puesto - Prioridad alta

Ruta base: **RH > Catalogos > Puestos**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-03-01 | Crear puesto con codigo, area, centro, jefe y personal a cargo. | El puesto aparece solo en la estructura autorizada. | | |
| RH-03-02 | Registrar objetivo, funciones, responsabilidades y autoridad. | La ficha conserva todos los campos. | | |
| RH-03-03 | Registrar escolaridad, experiencia, conocimientos y competencias. | Los requisitos se consultan desde el perfil. | | |
| RH-03-04 | Relacionar certificaciones, maquinaria, herramientas y sustancias. | Las relaciones aparecen en perfil y controles aplicables. | | |
| RH-03-05 | Relacionar riesgos, EPP, aptitud y capacitacion. | El sistema identifica requisitos obligatorios del puesto. | | |
| RH-03-06 | Definir jornada, turnos, tabulador e indicadores. | El expediente hereda o valida la configuracion aplicable. | | |
| RH-03-07 | Editar y aprobar una nueva version del perfil. | Conserva elaborador, revisor, aprobador, version y vigencia. | | |
| RH-03-08 | Generar el documento del perfil y acuse. | Archivo descargable con version y ocupantes. | | |
| RH-03-09 | Comparar un colaborador con su perfil. | Se muestran brechas concretas y no solo un porcentaje. | | |
| RH-03-10 | Publicar un cambio de perfil. | Los ocupantes reciben una sola notificacion y queda evidencia. | | |

## 04. Reclutamiento responsable - Prioridad alta

Ruta esperada: **RH > Reclutamiento**. Si no existe una ruta operativa, marcar `NI`.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-04-01 | Crear y autorizar una vacante ligada a perfil vigente. | No admite perfil vencido o inactivo. | | |
| RH-04-02 | Registrar candidato, fuente, agencia y oferta. | Expediente de candidato completo y restringido. | | |
| RH-04-03 | Registrar licencia y evaluacion de agencia. | Alerta vigencia e impide usar agencia no aprobada. | | |
| RH-04-04 | Guardar salario, jornada y condiciones comunicadas. | Queda una version fechada de la oferta. | | |
| RH-04-05 | Registrar cuotas y reembolsos del candidato. | Monto, concepto, evidencia y resolucion auditables. | | |
| RH-04-06 | Convertir candidato a colaborador y comparar oferta/contrato. | Diferencias visibles antes de autorizar. | | |
| RH-04-07 | Registrar criterios y motivo de rechazo. | Motivo obligatorio, objetivo y con acceso restringido. | | |
| RH-04-08 | Revisar alertas de discriminacion. | Reporte explica la diferencia y permite investigarla. | | |

## 05. Registro del colaborador - Prioridad critica

Ruta base: **RH > Gestion de personal > Agregar personal / Carga masiva**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-05-01 | Crear colaborador con identidad, nacimiento, CURP, RFC y NSS. | Numero laboral unico; duplicados se rechazan o justifican. | | |
| RH-05-02 | Capturar nacionalidad, domicilio, contacto y permiso migratorio. | Campos protegidos y permiso migratorio con vigencia. | | |
| RH-05-03 | Asignar empresa, centro, area, puesto, jefe y fecha de ingreso. | Solo ofrece catalogos del alcance y evita ciclos de jefatura. | | |
| RH-05-04 | Capturar contrato, turno, jornada, salario y forma de pago. | Salario queda oculto para usuarios sin permiso. | | |
| RH-05-05 | Marcar agencia, joven, migrante o tercerizado. | Se activan requisitos y alertas correspondientes. | | |
| RH-05-06 | Probar menor de edad y documento invalido. | Bloquea o alerta conforme a la regla aplicable. | | |
| RH-05-07 | Probar salario bajo, plaza inexistente o certificacion faltante. | El sistema informa cada incumplimiento. | | |
| RH-05-08 | Guardar expediente incompleto y consultar integridad. | Lista exacta de documentos/campos pendientes. | | |
| RH-05-09 | Activar al colaborador. | Alta disponible para asistencia, nomina, EPP y capacitacion sin duplicarlo. | | |

## 06. Contratos y empleo regular - Prioridad alta

Ruta base: **RH > Expediente > Documentos y condiciones laborales**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-06-01 | Crear tipos de contrato y plantilla. | Catalogo versionado y restringido. | | |
| RH-06-02 | Generar contrato desde expediente. | Incluye puesto, funciones, salario, jornada y prestaciones. | | |
| RH-06-03 | Seleccionar idioma y registrar firmas. | Documento comprensible y firmas auditables. | | |
| RH-06-04 | Registrar entrega de copia. | Acuse descargable con fecha y version. | | |
| RH-06-05 | Sustituir contrato vigente. | El anterior sigue disponible como historico. | | |
| RH-06-06 | Crear contrato proximo a vencer. | Aparece alerta de vencimiento y renovacion repetida. | | |
| RH-06-07 | Usar contrato temporal en puesto permanente. | Genera alerta o justificacion obligatoria. | | |
| RH-06-08 | Cambiar salario, puesto o jornada. | Genera convenio modificatorio, no sobreescribe el contrato. | | |

## 07. Empleo libremente elegido - Prioridad critica

Ruta base actual: **RH > Cumplimiento**. Los controles no disponibles se marcan `NI`.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-07-01 | Registrar declaracion de contratacion voluntaria. | Declaracion versionada y aceptada por el colaborador. | | |
| RH-07-02 | Confirmar ausencia de deposito, coercion o penalizacion. | Respuestas y excepciones quedan protegidas. | | |
| RH-07-03 | Registrar recepcion y devolucion de originales. | No conserva originales sin motivo; genera acuse. | | |
| RH-07-04 | Registrar prestamos, deudas y descuentos. | Monto, consentimiento, saldo e historial verificables. | | |
| RH-07-05 | Confirmar libertad de renuncia y salida. | Evidencia accesible para auditoria. | | |
| RH-07-06 | Registrar voluntariedad de horas extra. | Consentimiento ligado a fecha/periodo y revocable. | | |
| RH-07-07 | Crear reporte anonimo de coercion en Cumplimiento. | Folio confidencial, identidad protegida e historial permanente. | | |

## 08. Jornada, turnos y asistencia - Prioridad critica

Ruta base: **RH > Visualizar horarios** y **RH > Catalogos > Turnos**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-08-01 | Crear turno con varias jornadas, descansos y tolerancia. | Resumen semanal correcto y sin traslapes. | | |
| RH-08-02 | Importar/capturar horario real con entradas, salidas y faltas. | Registro por fecha y colaborador; no confundir con altas/bajas. | | |
| RH-08-03 | Comparar programado contra real. | Calcula ordinarias, extra y dias consecutivos. | | |
| RH-08-04 | Probar semana sin descanso suficiente. | Genera alerta diaria/semanal. | | |
| RH-08-05 | Corregir una marcacion con motivo y autorizacion. | La correccion requiere permiso y motivo. | | |
| RH-08-06 | Consultar la correccion. | Muestra anterior, nuevo, usuario, fecha y motivo. | | |
| RH-08-07 | Cerrar periodo e intentar editarlo. | Bloquea cambios sin reapertura autorizada. | | |
| RH-08-08 | Comparar contra acceso/produccion si hay integracion. | Diferencias visibles o `NA` justificado. | | |
| RH-08-09 | Enviar incidencias validadas a prenomina. | Solo autorizadas aparecen en el periodo. | | |

## 09. Horas extra - Prioridad critica

Ruta esperada: **RH > Horas extra / Horarios**. Si no existe, marcar `NI`.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-09-01 | Crear solicitud con motivo, fecha y cantidad. | Folio y estado inicial auditables. | | |
| RH-09-02 | Autorizar y capturar consentimiento. | Ambos pasos quedan separados con fecha. | | |
| RH-09-03 | Superar limites o descanso minimo. | Bloquea o escala el riesgo. | | |
| RH-09-04 | Autorizar y enviar a nomina. | Tarifa e importe preliminar correctos. | | |
| RH-09-05 | Comparar trabajadas contra pagadas. | Diferencia por colaborador y periodo. | | |
| RH-09-06 | Repetir excesos o quitar consentimiento. | Alerta recurrencia y falta de consentimiento. | | |
| RH-09-07 | Intentar programar con riesgo critico. | Programacion bloqueada con explicacion. | | |

## 10. Vacaciones - Prioridad alta

Ruta base: **RH > Expediente > Vacaciones**, **Portal > Nueva solicitud** y
**RH > Catalogos > Planes / Politicas / Festivos**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-10-01 | Cambiar fecha de ingreso y revisar antiguedad/plan. | Derecho se calcula conforme al plan vigente. | | |
| RH-10-02 | Abrir una solicitud. | Muestra ganados, usados, reservados, disponibles y proyeccion restante. | | |
| RH-10-03 | Solicitar dias validos, sin saldo, traslapados y sin cobertura. | Cada caso acepta, advierte o bloquea segun politica. | | |
| RH-10-04 | Aprobar y rechazar con motivo. | Decision, responsable, fecha y comentario en historial. | | |
| RH-10-05 | Aprobar vacaciones y abrir el calendario/prenomina. | Ausencia se refleja automaticamente donde corresponde. | | |
| RH-10-06 | Verificar prima vacacional. | Importe, formula y periodo visibles antes del pago. | | |
| RH-10-07 | Imprimir comprobante y cancelar. | PDF/impresion con folio; cancelacion revierte saldo con movimiento. | | |
| RH-10-08 | Crear saldo proximo a vencer o rechazos repetidos. | Alertas a tres y un mes; detecta trabajo durante vacaciones. | | |

## 11. Permisos e incapacidades - Prioridad alta

Ruta base: **RH > Expediente > Permiso/Incapacidad** y **Portal > Solicitudes**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-11-01 | Crear/usar permiso con y sin goce. | Tipo estable y efecto economico claramente indicado. | | |
| RH-11-02 | Solicitar con evidencia y autorizar/rechazar. | Fechas, adjuntos e historial completos. | | |
| RH-11-03 | Aprobar permiso sin goce. | Calendario se actualiza y la incidencia llega a prenomina. | | |
| RH-11-04 | Registrar incapacidad, folio, duracion y restriccion. | Ausencia automatica y datos medicos separados. | | |
| RH-11-05 | Abrir con usuario sin permiso medico. | No muestra diagnostico ni documento; intento en bitacora. | | |
| RH-11-06 | Registrar reincorporacion. | Valida compatibilidad con puesto y restricciones. | | |
| RH-11-07 | Capturar asistencia durante incapacidad. | Genera alerta y conserva evidencia. | | |

## 12. Nomina y pagos - Prioridad critica

Ruta base: **RH > Nomina y CFDI**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-12-01 | Crear periodo y calcular prenomina. | Integra contrato, salario e incidencias autorizadas. | | |
| RH-12-02 | Capturar percepciones, ISR, IMSS y deducciones. | Neto y totales se recalculan correctamente. | | |
| RH-12-03 | Probar salario bajo, tabulador distinto o pago por pieza. | Alerta diferencias antes de finalizar. | | |
| RH-12-04 | Incluir horas extra. | Valida tarifa y pago completo. | | |
| RH-12-05 | Capturar descuento sin fundamento. | Exige concepto, autorizacion y evidencia. | | |
| RH-12-06 | Comparar horas trabajadas/pagadas. | Diferencias identificadas por colaborador. | | |
| RH-12-07 | Importar/registrar deposito bancario. | Conciliacion contra recibo y excepciones. | | |
| RH-12-08 | Registrar fecha de pago. | Alerta pagos tardios. | | |
| RH-12-09 | Consultar brecha de salario digno/igualdad. | Metodologia, muestra y diferencias explicables. | | |
| RH-12-10 | Calcular, revisar y finalizar prenomina; generar recibo. | Borrador editable y cierre protegido con totales. | | |
| RH-12-11 | Cerrar periodo e intentar recalcular. | Resultados historicos congelados; reapertura autorizada. | | |

## 13. Riesgos laborales - Prioridad critica

Ruta base: **Seguridad y salud > Riesgos**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-13-01 | Crear peligro, riesgo, maquina y sustancia. | Catalogos unicos y activos. | | |
| RH-13-02 | Relacionar riesgo con area, puesto y actividad. | Solo afecta a la poblacion relacionada. | | |
| RH-13-03 | Evaluar probabilidad y severidad. | Nivel calculado de forma repetible. | | |
| RH-13-04 | Definir controles, EPP, curso y aptitud. | Requisitos vinculados al riesgo. | | |
| RH-13-05 | Asignar responsable y vigencia. | Alertas antes del vencimiento. | | |
| RH-13-06 | Publicar nueva matriz. | Version anterior permanece disponible. | | |
| RH-13-07 | Cerrar accidente/cambio de proceso. | Solicita reevaluacion del riesgo. | | |
| RH-13-08 | Publicar cambios. | Afectados reciben notificacion unica. | | |

## 14. Equipo de proteccion personal - Prioridad alta

Ruta base: **Seguridad y salud > EPP**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-14-01 | Crear EPP y ligarlo a riesgo/puesto. | Requisito visible en puesto y colaborador. | | |
| RH-14-02 | Entregar EPP con cantidad, talla y acuse. | Inventario/entrega e historial consistentes. | | |
| RH-14-03 | Registrar reposicion, devolucion, dano o perdida. | Movimiento con motivo y responsable. | | |
| RH-14-04 | Configurar vencimiento/faltante. | Alerta antes de quedar sin EPP. | | |
| RH-14-05 | Intentar asignar actividad critica sin EPP. | Actividad bloqueada o riesgo escalado. | | |
| RH-14-06 | Generar historial y reporte por area. | Totales coinciden con entregas. | | |

## 15. Capacitacion y competencias - Prioridad alta

Ruta esperada: **RH o Seguridad y salud > Capacitacion**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-15-01 | Crear curso con vigencia. | Codigo unico y estado activo. | | |
| RH-15-02 | Ligarlo a puesto, riesgo y actividad. | Poblacion objetivo automatica. | | |
| RH-15-03 | Abrir matriz puesto-curso y plan individual. | Brechas correctas por persona. | | |
| RH-15-04 | Crear programa anual y sesion. | Calendario, cupo y responsable. | | |
| RH-15-05 | Capturar instructor, asistencia y evaluacion. | Resultado individual auditable. | | |
| RH-15-06 | Emitir constancia. | Documento con curso, fecha y vigencia. | | |
| RH-15-07 | Vencer/reprobar un curso. | Alerta y reprogramacion. | | |
| RH-15-08 | Intentar actividad critica sin curso vigente. | Bloqueo o escalamiento. | | |
| RH-15-09 | Generar matriz de competencias. | Datos coinciden con perfiles y resultados. | | |

## 16. Evaluaciones y movimientos - Prioridad media

Ruta esperada: **RH > Evaluaciones / Expediente > Historial laboral**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-16-01 | Crear evaluacion ligada al puesto. | Criterios objetivos y versionados. | | |
| RH-16-02 | Registrar resultado y plan. | Retroalimentacion y acciones con fecha. | | |
| RH-16-03 | Promover, transferir o cambiar salario. | Flujo de autorizacion y fecha efectiva. | | |
| RH-16-04 | Comparar contra nuevo perfil. | Brechas antes de aprobar. | | |
| RH-16-05 | Validar competencias, EPP, riesgos y tabulador. | No omite requisitos criticos. | | |
| RH-16-06 | Autorizar movimiento. | Contrato, puesto, salario y expediente sincronizados. | | |
| RH-16-07 | Rechazar/autorizar. | Historial y motivo inalterables. | | |
| RH-16-08 | Revisar reporte de decisiones. | Permite detectar diferencias por grupo sin exponer datos indebidamente. | | |

## 17. Libertad de asociacion - Prioridad media

Ruta esperada: **RH > Relaciones laborales**. Si no existe, marcar `NI`.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-17-01 | Registrar sindicato y representantes. | Vigencia e informacion protegidas. | | |
| RH-17-02 | Registrar convenio, reunion, acta y acuerdo. | Documentos versionados. | | |
| RH-17-03 | Crear compromiso y seguimiento. | Responsable, fecha y estado. | | |
| RH-17-04 | Registrar representacion alternativa. | Mismo nivel de proteccion. | | |
| RH-17-05 | Probar acceso sin permiso sindical. | Informacion oculta y acceso registrado. | | |
| RH-17-06 | Registrar cambio desfavorable posterior. | Alerta posible represalia. | | |

## 18. Quejas, acoso y no represalias - Prioridad critica

Ruta base: **RH > Cumplimiento**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-18-01 | Crear caso identificado y anonimo. | Ambos generan caso; el anonimo no expone identidad. | | |
| RH-18-02 | Guardar el folio y consultar detalle. | Seguimiento confidencial y acceso limitado. | | |
| RH-18-03 | Elegir categoria, prioridad y riesgo. | Clasificacion visible y auditable. | | |
| RH-18-04 | Asignar investigador. | Responsable registrado; comprobar control de conflicto de interes. | | |
| RH-18-05 | Iniciar investigacion, agregar evidencia y conclusion. | Historial cronologico y evidencias protegidas. | | |
| RH-18-06 | Resolver y apelar. | Resolucion comunicada y apelacion conserva la anterior. | | |
| RH-18-07 | Dejar caso vencer/escalar y registrar satisfaccion. | Alertas por plazo y seguimiento posterior. | | |
| RH-18-08 | Registrar sancion, baja o cambio posterior. | Alerta posible represalia. | | |
| RH-18-09 | Consultar analisis por area/supervisor. | Tendencias anonimizadas y reincidencia visible. | | |

## 19. Medidas disciplinarias - Prioridad media

Ruta esperada: **RH > Relaciones laborales > Disciplina**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-19-01 | Crear falta y medida permitida. | Catalogo con fundamento y vigencia. | | |
| RH-19-02 | Registrar incidente, audiencia, evidencias y testigos. | Expediente disciplinario protegido. | | |
| RH-19-03 | Autorizar sancion y apelar. | Separacion de funciones e historial. | | |
| RH-19-04 | Intentar descuento disciplinario. | Bloqueo si no tiene fundamento autorizado. | | |
| RH-19-05 | Comparar dos casos similares. | Diferencias y justificacion visibles. | | |
| RH-19-06 | Relacionar con queja anterior. | Alerta de posible represalia. | | |
| RH-19-07 | Intentar editar historial cerrado. | No permite alteracion; genera nuevo movimiento. | | |

## 20. Accidentes e incidentes - Prioridad critica

Ruta base: **Seguridad y salud > Accidentes e incidentes**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-20-01 | Registrar accidente, incidente y casi accidente. | Folio y clasificacion correcta. | | |
| RH-20-02 | Capturar colaborador, puesto, lugar, fecha y lesion. | Relacion consistente con expediente. | | |
| RH-20-03 | Registrar atencion, incapacidad y reincorporacion. | Impacta calendario sin exponer diagnostico. | | |
| RH-20-04 | Investigar causa raiz. | Relaciona riesgos del puesto. | | |
| RH-20-05 | Crear accion correctiva. | Responsable, compromiso y evidencia. | | |
| RH-20-06 | Cerrar accion. | Actualiza riesgos, EPP o capacitacion relacionados. | | |
| RH-20-07 | Consultar estadisticas. | Conteos y reincidencias coinciden con casos. | | |

## 21. Personal tercerizado - Prioridad alta

Ruta base: **RH > Expediente > Contratacion = Contratista**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-21-01 | Crear contratista/agencia. | Catalogo unico y estado de aprobacion. | | |
| RH-21-02 | Adjuntar contrato, licencia y evaluacion. | Vigencias y alertas. | | |
| RH-21-03 | Crear trabajadores asignados. | Expedientes ligados al proveedor. | | |
| RH-21-04 | Validar contrato, salario, jornada y seguridad social. | Incumplimientos visibles. | | |
| RH-21-05 | Validar edad, capacitacion, aptitud y EPP. | No permite asignacion critica incompleta. | | |
| RH-21-06 | Vencer un documento. | Alerta por persona y proveedor. | | |
| RH-21-07 | Desaprobar proveedor e intentar alta. | Bloquea nuevas asignaciones sin borrar historico. | | |
| RH-21-08 | Programar evaluacion periodica. | Tarea/alerta en la fecha establecida. | | |

## 22. Baja y finiquito - Prioridad alta

Ruta base: **RH > Expediente > Dar de baja** y **Nomina**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-22-01 | Registrar baja con motivo y evidencia. | Fecha, responsable y motivo obligatorios. | | |
| RH-22-02 | Dar de baja a persona con queja/proteccion. | Revisa casos y actividad protegida. | | |
| RH-22-03 | Intentar baja potencialmente represiva. | Alerta y autorizacion reforzada. | | |
| RH-22-04 | Calcular pendientes. | Incluye salario, vacaciones y prestaciones. | | |
| RH-22-05 | Generar y autorizar finiquito. | Desglose y responsables. | | |
| RH-22-06 | Registrar pago y documentos entregados. | Comprobante y acuse. | | |
| RH-22-07 | Registrar entrevista y cerrar accesos. | Sesiones revocadas y respuestas protegidas. | | |
| RH-22-08 | Consultar expediente despues de baja. | Inactivo, no eliminable y con historial completo. | | |

## 23. Gestion documental - Prioridad alta

Ruta base: **Nucleo > Archivos y documentos** y **RH > Expediente > Documentos**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-23-01 | Crear tipo documental y requisito. | Categoria y sensibilidad configuradas. | | |
| RH-23-02 | Cargar documento con emision, vigencia y version. | Metadatos completos y checksum. | | |
| RH-23-03 | Aprobar/firmar/acuse. | Cada decision queda en historial. | | |
| RH-23-04 | Cargar documento proximo a vencer. | Alerta dentro del plazo configurado. | | |
| RH-23-05 | Intentar eliminar documento. | Retiro logico o autorizacion especial; nunca desaparece la evidencia. | | |
| RH-23-06 | Sustituir archivo. | Version anterior consultable. | | |
| RH-23-07 | Abrir medico/salarial/CFDI sin permiso. | Acceso denegado y auditado. | | |
| RH-23-08 | Generar paquete de auditoria. | Indice y archivos coinciden con muestra y permisos. | | |

## 24. Auditorias SMETA - Prioridad critica

Ruta esperada: **RH > Cumplimiento > Auditorias**. Si no existe, marcar `NI`.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-24-01 | Crear auditoria con centro, alcance y periodo. | Folio y responsables. | | |
| RH-24-02 | Seleccionar requisitos y muestra. | Muestra reproducible y protegida. | | |
| RH-24-03 | Revisar expedientes, perfiles y contratos. | Resultado por requisito con evidencia. | | |
| RH-24-04 | Cruzar asistencia, extra, nomina y banco. | Diferencias cuantificadas. | | |
| RH-24-05 | Revisar vacaciones, riesgos, EPP y cursos. | Vinculos a registros originales. | | |
| RH-24-06 | Registrar entrevistas. | Identidad protegida segun confidencialidad. | | |
| RH-24-07 | Adjuntar evidencia y clasificar. | Archivos, criticidad y autor. | | |
| RH-24-08 | Generar reporte y plan. | Documento descargable y hallazgos vinculados. | | |

## 25. Hallazgos y acciones correctivas CAPA - Prioridad critica

Ruta esperada: **RH > Cumplimiento > CAPA**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-25-01 | Crear hallazgo con origen, requisito, area y proceso. | Folio y relacion con auditoria/caso. | | |
| RH-25-02 | Adjuntar evidencia y criticidad. | Acceso protegido y clasificacion. | | |
| RH-25-03 | Registrar contencion. | Fecha, responsable y evidencia inmediata. | | |
| RH-25-04 | Registrar causa raiz. | Metodo y conclusion documentados. | | |
| RH-25-05 | Crear plan con responsable y compromiso. | Fechas y alertas. | | |
| RH-25-06 | Registrar avance. | Porcentaje e evidencia historica. | | |
| RH-25-07 | Cerrar por usuario independiente. | Impide autocierre cuando aplique. | | |
| RH-25-08 | Medir eficacia. | Resultado y reincidencia. | | |
| RH-25-09 | Fallar eficacia o vencer fecha. | Reabre o escala automaticamente. | | |

## 26. Seguridad, permisos y trazabilidad - Prioridad critica

Ruta base: **Centro de Gestion**, **Nucleo > Bitacora** y permisos del ERP.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-26-01 | Crear identidades con distintos niveles de RH. | Modulos y permisos coinciden con el perfil. | | |
| RH-26-02 | Probar salario, medico, sindical y quejas sin permisos. | Ningun permiso general concede acceso automatico. | | |
| RH-26-03 | Consultar bitacora despues de alta, vista, cambio y baja. | Cada accion aparece una sola vez. | | |
| RH-26-04 | Editar un dato auditado. | Valor anterior/nuevo, usuario, fecha y hora. | | |
| RH-26-05 | Intentar modificar la bitacora desde interfaz/API. | Operacion no disponible o denegada. | | |
| RH-26-06 | Editar periodo cerrado y reabrir con/sin permiso. | Solo permiso especial y motivo permiten reapertura. | | |
| RH-26-07 | Verificar respaldo y conservacion. | Restauracion probada en ambiente separado y politica registrada. | | |

## 27. Tablero de cumplimiento - Prioridad media

Ruta base: **RH > Gestion de personal** y **RH > Cumplimiento**.

| ID | Prueba funcional | Resultado esperado / evidencia | Estado | Evidencia / observacion |
| --- | --- | --- | --- | --- |
| RH-27-01 | Crear expediente/contrato incompleto. | Aparece en alertas con faltantes exactos. | | |
| RH-27-02 | Crear contrato, permiso o documento proximo a vencer. | Indicador y enlace al registro. | | |
| RH-27-03 | Dejar perfil incompleto o brecha. | Conteo y detalle correctos. | | |
| RH-27-04 | Marcar joven/migrante con requisito pendiente. | Alerta sin discriminacion ni exposicion innecesaria. | | |
| RH-27-05 | Crear jornada excesiva o falta de descanso. | Indicador con periodo y colaborador. | | |
| RH-27-06 | Crear hora extra no pagada/salario insuficiente. | Diferencia cuantificada. | | |
| RH-27-07 | Crear saldo acumulado/proximo a vencer. | Dias y ciclo correctos. | | |
| RH-27-08 | Vencer curso o EPP. | Alerta y acceso al requisito. | | |
| RH-27-09 | Vencer queja o CAPA / registrar posible represalia. | Indicador protegido y priorizado. | | |
| RH-27-10 | Pulsar cada indicador. | Navega al registro y evidencia original sin romper permisos. | | |

---

## 7. Cierre de la revision

| Resultado | Cantidad |
| --- | ---: |
| NI | |
| ED | |
| PR | |
| OK | |
| MI | |
| NA | |
| Total | |

### Hallazgos criticos

| No. | ID | Hallazgo | Riesgo | Responsable | Fecha objetivo | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

### Registro de evidencias

Use nombres estables, por ejemplo:

`RH-18-05_CAS-000001_historial_2026-08-19.png`

| ID | Folio o registro | Evidencia | Ubicacion | Revisor | Fecha |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

### Aprobacion

| Rol | Nombre | Resultado | Fecha | Firma / referencia |
| --- | --- | --- | --- | --- |
| Administrador RH | | | | |
| Seguridad / Cumplimiento | | | | |
| Responsable tecnico | | | | |

## 8. Regla final

No trasladar una funcion a produccion solo porque su estado sea `PR`. Debe tener
evidencia, permisos negativos probados, trazabilidad y aceptacion del responsable
funcional. Los datos sinteticos y evidencias de prueba no deben copiarse a la
base productiva.
