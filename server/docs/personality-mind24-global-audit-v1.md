# Personalidad Mind24 — Auditoría global del banco inicial v1

**Fase:** 3A (auditoría) + 3B (consolidación editorial)  
**Baseline contenido:** PERSONALIDAD MIND24 — FASE 2 CONTENT BASELINE v1 CLOSED  
**Blueprint:** v3.6  
**Commit de referencia Fase 2:** `44c843e0eb35c49f5eed91fc5f07a49e5b6faec4`  
**Fecha:** 2026-10-02  
**Alcance:** 80 reactivos `draft` · 10 dimensiones · 8 por dimensión · 10 inversos  

**FASE 3B — CONSOLIDACIÓN EDITORIAL CLOSED**

**SHORTLIST EDITORIAL PROVISIONAL:  
60 PRIORITARIOS / 20 RESERVAS**

Los 60 **no** son selección oficial de `production`. `bankStatus` permanece `draft`. Módulo inactivo.

`DROP_CANDIDATE` **no significa eliminar**: es una recomendación editorial previa a revisión humana, experta y pilotaje.

---

## A. Resumen ejecutivo

El banco inicial es **coherente como sistema**: cada dimensión tiene definición operacional, facetas distinguibles y, en general, trade-offs laborales plausibles. No hay dimensión estructuralmente rota. El problema dominante no es la validez de constructo de los bloques, sino **redundancia intrafaceta** (paráfrasis del mismo indicador) y **fronteras recurrentes** entre pares de dimensiones.

| Hallazgo | Lectura |
|----------|---------|
| Fortaleza | Neutralidad valorativa trabajada; inversos en su mayoría naturales; aplicabilidad laboral amplia en la mayoría del banco |
| Debilidad principal | Facetas A infladas en Influencia, Liderazgo, Apego a normas y Dinamismo (tríadas casi parafrásticas) |
| Frontera más sensible | Sociabilidad ↔ Liderazgo (`040` ∥ `048`; `038` ↔ `044`/`045`) |
| Segunda frontera | Apego a normas ↔ Adaptabilidad (`049`/`051` ↔ `074`/`080`) |
| Tercera frontera | Orden ↔ Repriorización (`009`/`011` ↔ `076`/`078`) |
| Deseabilidad residual | Moderada e inevitable en persistencia, liderazgo y “cerrar pendientes”; pocos ítems con ideal *alto* y evidente |
| Experiencia | Riesgo concentrado en trabajo grupal (dim. 5–6), cifras (012/014) y procesos formales (053/055) |

**Clasificación provisional (80):**

| Clase | n | % |
|-------|---|---|
| KEEP_PRIORITY | 43 | 54% |
| REVIEW | 23 | 29% |
| DROP_CANDIDATE | 14 | 18% |

**Shortlist editorial (no oficial):** 60 prioritarios + 20 reservas. No cambia `bankStatus`. No es la selección final de 60 `production`.

---

## B. Matriz de 80 reactivos

Leyenda de riesgos: **low / medium / high**.  
Claridad y oportunidad: misma escala (oportunidad **high** = depende más de un contexto laboral específico).  
Calidad del inverso: solo si `direction = inverse`.

### Dimensión 1 — Orientación al logro y persistencia

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_001 | A. Enfoque en metas | D | Cuando tengo varios pendientes abiertos, concentro primero mi esfuerzo en los que más contribuyen al resultado acordado. | high | medium | medium | orden_precision | high | low | — | 003, 076 | REVIEW | Prioriza por contribución al resultado; cerca de 003 y de “ordenar” el día. Ideal algo evidente (“lo que más aporta”). |
| pm24_002 | A. Enfoque en metas | D | Mientras avanzo en una tarea, verifico si lo que estoy haciendo sigue acercándome al resultado esperado. | medium | low | low | orden_precision (baja) | high | low | — | — | KEEP_PRIORITY | Único indicador de *monitoreo hacia la meta* durante la ejecución. Limpio. |
| pm24_003 | A. Enfoque en metas | D | Cuando aparecen tareas secundarias durante un trabajo, vuelvo a centrar mi esfuerzo en el objetivo principal. | medium | medium | medium | adaptabilidad_cambio | high | low | — | 001, 076 | REVIEW | Resiste desviación hacia lo secundario. Contrapunto conceptual de 076 (repriorizar). Útil, no idéntico a 001. |
| pm24_004 | B. Persistencia ante obstáculos | D | Cuando una tarea se complica más de lo previsto, hago nuevos intentos antes de dejarla pendiente. | medium | high | low | — | high | low | — | 005 | KEEP_PRIORITY | Persistencia más nítida del banco. 005 es casi paráfrasis. |
| pm24_005 | B. Persistencia ante obstáculos | D | Si una tarea requiere más intentos de los previstos, suelo mantener el trabajo en ella aunque avance más lento de lo que tenía previsto. | medium | high | low | — | high | low | — | 004 | DROP_CANDIDATE | Mismo indicador que 004 (seguir intentando ante dificultad). Aporta poco diferencial. |
| pm24_006 | B. Persistencia ante obstáculos | I | Después de varios intentos sin avance en una tarea, suelo dejarla en pausa y concentrarme temporalmente en otras actividades. | medium | medium | low | dinamismo_iniciativa (baja) | high | low | alta | 004, 005 | KEEP_PRIORITY | Inverso natural; continuidad vs pausa táctica. No caricaturiza abandono. |
| pm24_007 | C. Conclusión y seguimiento | D | Después de completar la parte principal de una tarea, doy seguimiento a los pendientes relacionados hasta dejarlos cerrados. | high | medium | low | orden_precision | high | low | — | 008 | REVIEW | Cierre de colas; deseabilidad alta (“dejar cerrado”). Distinto de 008 (retomar tras interrupción). |
| pm24_008 | C. Conclusión y seguimiento | D | Cuando dejo una tarea a medias para atender otra prioridad, procuro retomarla después hasta cerrarla. | medium | medium | medium | adaptabilidad_cambio | high | low | — | 007, 078 | KEEP_PRIORITY | Cierre *después* de un cambio de atención. Complementa 076/078 sin medir reorden. |

### Dimensión 2 — Orden y precisión

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_009 | A. Organización del trabajo | D | Antes de abordar varios pendientes del mismo trabajo, defino el orden en que los iré atendiendo. | medium | high | medium | adaptabilidad_cambio | high | low | — | 011, 076 | REVIEW | Orden *a priori*. Frontera con 076 (cambiar ese orden). Más limpio que 011. |
| pm24_010 | A. Organización del trabajo | D | Mientras trabajo con varios archivos o materiales, suelo dedicar algo de tiempo a mantenerlos organizados en lugar de ordenarlos hasta que termino. | medium | low | low | — | medium | low | — | — | KEEP_PRIORITY | Único trade-off “ordenar durante vs al final”. Conducta concreta. |
| pm24_011 | A. Organización del trabajo | D | Cuando una tarea implica varios pasos, los ordeno antes de comenzar a ejecutarlos. | medium | high | medium | apego_normas | high | low | — | 009, 050 | DROP_CANDIDATE | Paráfrasis de 009 (secuenciar antes de ejecutar). 050 cubre secuencia *externa*. |
| pm24_012 | B. Atención al detalle | D | Al contrastar partes de un mismo trabajo, detecto cuando los datos o las cifras no cuadran entre sí. | medium | high | low | — | high | medium | — | 014 | REVIEW | Inconsistencia entre partes. Depende algo de trabajo con datos. |
| pm24_013 | B. Atención al detalle | D | Mientras avanzo, me doy cuenta si falta algún dato o pieza que necesito para seguir con lo que estoy haciendo. | medium | low | low | logro_persistencia (baja) | high | low | — | — | KEEP_PRIORITY | Detectar *ausencia* (no discrepancia). Aplicable a casi cualquier puesto. |
| pm24_014 | B. Atención al detalle | D | Noto diferencias pequeñas en cifras o detalles cuando podrían alterar el resultado del trabajo. | medium | high | low | — | high | medium | — | 012 | DROP_CANDIDATE | Casi el mismo indicador que 012; más atado a cifras. |
| pm24_015 | C. Revisión y control de calidad | D | Antes de cerrar una tarea, suelo dedicar un momento adicional a revisar los puntos que considero más relevantes. | medium | medium | medium | apego_normas | high | low | — | 016, 056 | KEEP_PRIORITY | Revisión de cierre autoimpuesta. Par limpio con 016. |
| pm24_016 | C. Revisión y control de calidad | I | Cuando considero que una tarea ya cumple con lo necesario, prefiero avanzar a la siguiente actividad en lugar de hacer una revisión adicional. | low | medium | medium | dinamismo_iniciativa | high | low | alta | 015, 056, 072 | KEEP_PRIORITY | Inverso natural (suficiencia vs revisión extra). Vigilar correlación con 056 y 072. |

### Dimensión 3 — Autonomía y seguridad para decidir

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_017 | A. Autogestión | D | Después de quedar claro el resultado esperado, suelo avanzar por mi cuenta hasta que aparece algo que realmente requiere consulta. | medium | low | low | logro_persistencia | high | low | — | 019 | KEEP_PRIORITY | Independencia operativa con umbral de consulta. Núcleo de A. |
| pm24_018 | A. Autogestión | D | Cuando surge una duda cotidiana en mi trabajo, suelo explorar primero una solución por mi cuenta antes de pedir apoyo. | medium | low | medium | sociabilidad_colaboracion | high | low | — | 035 | KEEP_PRIORITY | Explorar solo vs pedir. Contrapunto de 035 (acudir a la persona). |
| pm24_019 | A. Autogestión | I | Para avanzar con claridad en mi trabajo, me resulta útil tener revisiones frecuentes de avance con mi responsable. | low | low | medium | sociabilidad_colaboracion | high | medium | alta | 017, 055 | KEEP_PRIORITY | Inverso natural (acompañamiento vs autonomía). Requiere tener responsable. |
| pm24_020 | B. Seguridad decisional | D | Ante varias formas razonables de hacer una tarea, suelo elegir una antes de buscar una segunda opinión. | medium | high | medium | autonomia A | high | low | — | 022, 018 | DROP_CANDIDATE | Elige + evita segunda opinión: mezcla B con A. 022 mide la elección con más pureza. |
| pm24_021 | B. Seguridad decisional | D | Con la información disponible, suelo decidir entre las opciones presentes aunque queden aspectos sin cerrar por completo. | medium | low | medium | dinamismo_iniciativa | high | low | — | 069 | KEEP_PRIORITY | Decidir con información incompleta. 069 inicia; este decide. |
| pm24_022 | B. Seguridad decisional | D | Cuando dos alternativas me parecen igualmente viables, suelo elegir una y trabajar a partir de ella. | medium | high | low | — | high | low | — | 020 | REVIEW | Mismo núcleo que 020, más limpio. Conservar uno de los dos. |
| pm24_023 | C. Criterio propio | D | Antes de asumir la conclusión de otras personas, suelo formar mi propia lectura de la situación. | medium | high | medium | influencia_persuasion | high | low | — | 024 | REVIEW | Lectura propia vs adoptar la ajena. Cercano a 024. |
| pm24_024 | C. Criterio propio | D | Cuando recibo una recomendación sobre cómo proceder, suelo contrastarla con lo que yo observo antes de seguirla. | medium | high | medium | apego_normas | high | low | — | 023 | REVIEW | Contrastar recomendación. Útil; redundante con 023 si hay que recortar C. |

### Dimensión 4 — Influencia y persuasión interpersonal

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_025 | A. Argumentación | D | Cuando una propuesta de trabajo genera opiniones distintas, suelo exponer las razones por las que considero que puede funcionar. | medium | high | medium | liderazgo_equipos | high | low | — | 026, 027 | REVIEW | Exponer razones ante desacuerdo. Casi el mismo acto que 027. |
| pm24_026 | A. Argumentación | D | Cuando quiero que una idea sea tomada en cuenta, suelo desarrollar los argumentos que la respaldan en lugar de limitarme a plantearla. | medium | medium | low | — | high | low | — | 025 | KEEP_PRIORITY | Profundidad argumental vs solo enunciar. Mejor diferencial de A. |
| pm24_027 | A. Argumentación | D | Cuando alguien expresa una postura distinta sobre un tema de trabajo, suelo explicar los motivos de mi punto de vista. | medium | high | medium | regulacion_presion | high | low | — | 025 | DROP_CANDIDATE | Paráfrasis de 025 (explicar motivos ante postura distinta). |
| pm24_028 | B. Adaptación del mensaje | D | Cuando alguien no está convencido de una propuesta, suelo buscar otra manera de explicarle sus ventajas. | medium | medium | medium | adaptabilidad_cambio | high | low | — | 029 | REVIEW | Otra vía explicativa por *falta de convicción*. Cerca de 029. |
| pm24_029 | B. Adaptación del mensaje | D | Cuando noto que la otra persona no entendió lo que planteo, suelo reformular mi explicación antes de insistir con las mismas palabras. | medium | medium | low | sociabilidad_colaboracion | high | low | — | 028 | KEEP_PRIORITY | Reformular por *incomprensión*, no por desacuerdo. Más limpio. |
| pm24_030 | B. Adaptación del mensaje | D | Según con quién hable, suelo destacar distintos aspectos de una misma propuesta. | medium | low | low | — | high | medium | — | — | KEEP_PRIORITY | Único ítem de ajuste al interlocutor. Algo más “stakeholder”. |
| pm24_031 | C. Movilización | D | Cuando una propuesta queda sin una decisión clara, suelo aportar argumentos para ayudar a que la conversación avance hacia una conclusión. | medium | low | high | liderazgo_equipos | high | low | — | 042 | REVIEW | Empujar a conclusión con *argumentos*. 042 organiza el *avance grupal*. Frontera real. |
| pm24_032 | C. Movilización | I | Cuando una persona mantiene una opinión diferente después de escuchar mi punto, suelo dejar el tema ahí en lugar de buscar otro argumento. | low | low | low | regulacion_presion (baja) | high | low | alta | 028 | KEEP_PRIORITY | Inverso natural: no insistir vs seguir argumentando. Contraste útil. |

### Dimensión 5 — Sociabilidad y colaboración

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_033 | A. Apertura interpersonal | D | Cuando necesito coordinar algo con una persona que no conozco bien, suelo iniciar el contacto directamente. | medium | medium | low | — | high | low | — | 035 | KEEP_PRIORITY | Iniciar contacto con poco conocido. Apertura nítida. |
| pm24_034 | A. Apertura interpersonal | D | Al integrarme a un grupo de trabajo nuevo, suelo participar en los intercambios necesarios para entender cómo se trabaja. | medium | low | low | — | high | medium | — | — | KEEP_PRIORITY | Integración a grupo nuevo. Distinto de iniciar un contacto puntual. |
| pm24_035 | A. Apertura interpersonal | D | Cuando me falta información para avanzar en algo compartido, suelo acudir directamente a la persona involucrada. | medium | medium | medium | autonomia_decision | high | low | — | 033, 018 | REVIEW | Ir a la persona vs resolver solo (018). Útil; solapa 033. |
| pm24_036 | B. Cooperación | D | Cuando mi trabajo afecta lo que otra persona hará después, suelo mantenerla al tanto de los cambios relevantes. | medium | medium | low | — | high | low | — | 038 | REVIEW | Informar impacto aguas abajo. Cercano a 038. |
| pm24_037 | B. Cooperación | D | En trabajos compartidos, suelo hacer pausas breves para poner en común avances con los demás en lugar de esperar hasta el final para coordinarnos. | medium | low | low | dinamismo_iniciativa | medium | medium | — | — | KEEP_PRIORITY | Sincronizar durante vs al cierre. Trade-off claro. |
| pm24_038 | B. Cooperación | D | Cuando una tarea depende de varias personas, suelo alinear mi parte con lo que necesitan las demás para continuar. | medium | medium | high | liderazgo_equipos | high | medium | — | 036, 044, 077 | DROP_CANDIDATE | Alinear para que otros continúen: casi el mismo acto que 044/077 desde “mi parte”. |
| pm24_039 | C. Apoyo e integración | D | Cuando alguien del equipo tiene una duda sobre algo que conozco, suelo dedicar un momento a orientarlo antes de continuar con lo mío. | medium | low | low | logro_persistencia (baja) | high | medium | — | — | KEEP_PRIORITY | Ayuda puntual vs seguir lo propio. Faceta C más limpia. |
| pm24_040 | C. Apoyo e integración | I | Cuando cada persona tiene claramente definida su parte, prefiero concentrarme en la mía y ofrecer apoyo en las demás solo cuando me lo solicitan. | low | low | low | autonomia_decision (baja) | high | low | alta | 039 | KEEP_PRIORITY | Fase 3B: apoyo a demanda vs espontáneo. Ya no equivale a 048 (coordinación). |

### Dimensión 6 — Liderazgo y dirección de equipos

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_041 | A. Asunción de dirección | D | Cuando varias personas necesitan definir cómo continuar con una tarea, suelo participar en ordenar los siguientes pasos. | medium | high | medium | dinamismo_iniciativa | high | medium | — | 042, 043 | DROP_CANDIDATE | “Participar en ordenar” es la versión más débil de la tríada 041–043. |
| pm24_042 | A. Asunción de dirección | D | Cuando un trabajo grupal queda sin una dirección clara, suelo proponer una forma de organizar el avance. | high | high | medium | orden_precision | high | medium | — | 041, 043, 031 | REVIEW | Proponer organización. Deseabilidad en el límite; cerca de 043. |
| pm24_043 | A. Asunción de dirección | D | Cuando un grupo tiene claro qué debe lograr pero nadie está coordinando el arranque, suelo asumir temporalmente la organización de los primeros pasos. | medium | high | medium | dinamismo_iniciativa | medium | medium | — | 041, 042 | KEEP_PRIORITY | Condición más precisa (nadie coordina el arranque). Mejor de A. |
| pm24_044 | B. Coordinación | D | Cuando varias personas participan en una misma entrega, suelo ayudar a aclarar qué necesita avanzar primero para que el resto pueda continuar. | medium | high | high | adaptabilidad_cambio · sociabilidad | high | medium | — | 045, 077, 038 | REVIEW | Prioridad colectiva para desbloquear. Comparte escenario con 077. |
| pm24_045 | B. Coordinación | D | En trabajos donde intervienen varias personas, suelo señalar las dependencias entre partes para que cada quien sepa qué esperar. | medium | high | medium | orden_precision | high | medium | — | 044 | DROP_CANDIDATE | Dependencias = casi el mismo indicador que 044, más descriptivo. |
| pm24_046 | B. Coordinación | D | Cuando en un trabajo compartido hay responsabilidades que se traslapan, suelo ayudar a aclarar quién se encargará de cada parte. | medium | low | low | sociabilidad_colaboracion | high | medium | — | — | KEEP_PRIORITY | Clarificar *quién* (no *qué va primero*). Diferencial de B. |
| pm24_047 | C. Avance colectivo | D | Después de que un grupo acuerda un plan, suelo mantenerme atento al avance general además de concentrarme en mi propia parte. | medium | low | medium | sociabilidad_colaboracion | high | medium | — | 040 | KEEP_PRIORITY | Atención al conjunto vs solo la parte propia. Par de 048. |
| pm24_048 | C. Avance colectivo | I | Cuando el trabajo de un grupo ya tiene participantes capaces, prefiero concentrarme en mi propia parte y dejar la coordinación a otra persona. | low | low | high | sociabilidad_colaboracion | high | medium | media | 040 | KEEP_PRIORITY | Inverso de especialista. Natural. Riesgo: duplicar 040 si ambos quedan en formulario 60. |

### Dimensión 7 — Apego a normas y procesos

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_049 | A. Seguimiento de procedimientos | D | Cuando una actividad ya tiene un método establecido, suelo comenzar por ese método antes de explorar otra forma de hacerla. | medium | high | high | adaptabilidad_cambio | high | low | — | 050, 051, 080 | DROP_CANDIDATE | Tríada A. El más cercano a 080 (preferir el método vigente/familiar). |
| pm24_050 | A. Seguimiento de procedimientos | D | Cuando una tarea incluye una secuencia de pasos definida, suelo seguirla antes de resolverla por mi propio criterio. | medium | high | medium | autonomia_decision · orden | high | low | — | 049, 051, 011 | REVIEW | Secuencia *externa* vs criterio propio. Distinto de 011 (ordenar yo). |
| pm24_051 | A. Seguimiento de procedimientos | D | Si hay un procedimiento definido para un trabajo que ya conozco, suelo utilizarlo en lugar de improvisar los pasos sobre la marcha. | medium | high | low | dinamismo_iniciativa | high | low | — | 049, 050 | KEEP_PRIORITY | Procedimiento aun con dominio de la tarea. Mejor ancla de A. |
| pm24_052 | B. Consistencia con estándares | D | Cuando existe un criterio establecido para considerar una tarea terminada, suelo tomarlo como referencia aunque mi forma personal de evaluarla sea distinta. | medium | medium | medium | orden_precision | high | low | — | 015, 053 | KEEP_PRIORITY | Estándar externo de “terminada” ≠ revisión de calidad (015). |
| pm24_053 | B. Consistencia con estándares | D | Cuando distintas personas entregan un trabajo comparable, suelo utilizar los parámetros comunes en lugar de un criterio propio. | medium | medium | low | sociabilidad_colaboracion | high | medium | — | 052 | REVIEW | Parámetros comunes entre personas. Requiere entregas comparables. |
| pm24_054 | B. Consistencia con estándares | D | Si hay un formato establecido para presentar un trabajo, suelo usarlo aunque me resulte más natural otro esquema. | low | low | low | orden_precision | high | low | — | — | KEEP_PRIORITY | Trade-off más visible y neutro de B. Amplia aplicabilidad. |
| pm24_055 | C. Controles externos | D | Cuando un proceso incluye un punto de revisión o autorización antes de continuar, suelo incorporarlo al flujo de trabajo en lugar de avanzar de un tirón. | medium | medium | medium | autonomia · dinamismo | high | medium | — | 056, 019 | KEEP_PRIORITY | Control *del proceso* vs avance continuo. Distinto de pedir validación (019). |
| pm24_056 | C. Controles externos | I | Cuando una tarea incluye varios puntos de control, prefiero avanzar de forma continua y concentrar las revisiones al final cuando es posible. | low | medium | medium | orden_precision · dinamismo | high | low | media | 015, 016, 055 | KEEP_PRIORITY | Inverso plausible. “Cuando es posible” evita incumplir controles obligatorios. Correlación esperable con 016. |

### Dimensión 8 — Regulación bajo presión

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_057 | A. Autocontrol operativo | D | Cuando una conversación laboral se vuelve tensa, suelo cuidar la forma en que respondo aunque el intercambio siga siendo exigente. | medium | low | low | sociabilidad_colaboracion | high | medium | — | — | KEEP_PRIORITY | Regula *forma* bajo tensión, no simpatía ni calma declarada. |
| pm24_058 | A. Autocontrol operativo | D | Cuando algo me molesta durante el trabajo, suelo darme un momento antes de responder si la situación lo permite. | medium | low | low | — | high | low | — | — | KEEP_PRIORITY | Pausa ante molestia. Trade-off con responder al instante. Muy limpio. |
| pm24_059 | A. Autocontrol operativo | D | Cuando coinciden varias demandas urgentes, suelo evitar que la presión de una situación cambie la forma en que atiendo las demás. | medium | low | medium | adaptabilidad_cambio · orden | medium | medium | — | 076 | KEEP_PRIORITY | No *trasladar* presión a otras atenciones. No pide reordenar (076). |
| pm24_060 | B. Recuperación | D | Después de un contratiempo, suelo volver a concentrarme en lo que estoy haciendo aunque todavía tenga presente lo ocurrido. | medium | high | medium | logro_persistencia · dinamismo | high | low | — | 061, 062 | REVIEW | Reconcentración con lo ocurrido presente. Par directo de 062. |
| pm24_061 | B. Recuperación | D | Cuando cometo un error durante una jornada, suelo separar lo ocurrido de las tareas que siguen en lugar de continuar repasándolo mientras trabajo. | medium | high | medium | logro_persistencia | high | low | — | 060 | DROP_CANDIDATE | Separar error del resto ≈ reconcentrarse (060) con escenario de error. |
| pm24_062 | B. Recuperación | I | Después de un resultado que me toma por sorpresa, suelo necesitar un tiempo antes de volver a concentrarme en el trabajo. | low | medium | low | — | high | low | alta | 060 | KEEP_PRIORITY | Inverso natural de 060. No niega la emoción. |
| pm24_063 | C. Tolerancia a rechazo | D | Cuando una propuesta en la que trabajé no es aceptada, suelo poder continuar con el siguiente asunto sin quedarme demasiado tiempo en ese resultado. | medium | medium | medium | dinamismo_iniciativa | high | medium | — | 071, 064 | REVIEW | Seguir al siguiente asunto. Roza dinamismo (071). Requiere haber propuesto. |
| pm24_064 | C. Tolerancia a crítica | D | Después de recibir una observación crítica inesperada sobre mi trabajo, suelo volver al tema con suficiente distancia para seguir trabajando en él. | medium | medium | low | — | high | medium | — | 063 | KEEP_PRIORITY | Distancia para *seguir en el mismo tema* tras crítica. Más regulación que 063. |

### Dimensión 9 — Dinamismo e iniciativa laboral

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_065 | A. Nivel de actividad | D | Cuando durante la jornada hay varias actividades disponibles y ninguna requiere atención inmediata, suelo mantenerme atendiendo alguna de ellas en lugar de esperar a que surja algo prioritario. | medium | high | low | logro_persistencia | medium | low | — | 066, 067 | REVIEW | Activo vs esperar prioridad. Casi idéntico a 066. |
| pm24_066 | A. Nivel de actividad | D | Durante periodos con varias tareas disponibles, suelo mantenerme atendiendo alguna de ellas en lugar de dejar espacios largos entre actividades. | medium | high | low | — | high | low | — | 065, 067 | DROP_CANDIDATE | Paráfrasis de 065 (llenar el tiempo vs huecos). |
| pm24_067 | A. Nivel de actividad | D | Cuando en la jornada aparecen ratos sin una actividad inmediata, suelo pasarme a algo pendiente que pueda atender en ese momento. | medium | high | low | — | high | low | — | 065, 066 | KEEP_PRIORITY | Uso de *ratos muertos*. Misma familia, escenario más concreto. |
| pm24_068 | B. Inicio de acción | D | Cuando ya entiendo lo necesario para empezar una tarea, suelo dar un primer paso práctico antes de seguir afinando cómo la abordaré. | medium | medium | medium | autonomia_decision | high | low | — | 069, 070 | KEEP_PRIORITY | Actuar vs seguir planificando. Mejor de B. |
| pm24_069 | B. Inicio de acción | D | Cuando una tarea puede ponerse en marcha con la información disponible, suelo iniciar la parte que ya está definida aunque queden detalles menores por precisar. | medium | medium | medium | autonomia_decision | medium | low | — | 021, 068 | REVIEW | Iniciar con detalles menores pendientes. 021 decide; este arranca. |
| pm24_070 | B. Inicio de acción | D | Cuando me indican qué hacer y no falta información clave, suelo empezar a ejecutarlo en lugar de posponer el inicio. | high | medium | low | apego_normas (baja) | high | low | — | 068 | DROP_CANDIDATE | “Me indican + empiezo” es el más obvio del bloque (iniciativa deseable). |
| pm24_071 | C. Ritmo y empuje | D | Cuando termino una parte de mi trabajo, suelo enlazar con la siguiente sin necesitar una pausa larga entre ambas. | medium | medium | medium | logro_persistencia | high | low | — | 072, 063 | KEEP_PRIORITY | Enlace entre *partes*. Par de 072. |
| pm24_072 | C. Ritmo y empuje | I | Cuando termino una tarea, suelo tomarme un tiempo antes de comenzar la siguiente aunque ya sepa qué sigue. | low | medium | medium | orden_precision | high | low | alta | 071, 016 | KEEP_PRIORITY | Inverso natural (pausa entre tareas). Correlación posible con 016. |

### Dimensión 10 — Adaptabilidad y flexibilidad ante el cambio

| itemId | faceta | dir. | texto | des. | red. intra | red. inter | contaminación | claridad | oport. | inverso | solapa | clase | justificación |
|--------|--------|------|-------|------|------------|------------|---------------|----------|--------|---------|--------|-------|---------------|
| pm24_073 | A. Apertura operativa | D | Cuando cambia la forma en que debe hacerse una tarea, suelo ajustar mi manera de trabajar después de entender el nuevo esquema. | medium | high | medium | apego_normas | high | low | — | 075, 049 | REVIEW | Ajuste tras entender esquema nuevo. Cercano a 075. |
| pm24_074 | A. Apertura operativa | D | Cuando se introduce una nueva forma de trabajo, suelo empezar a incorporarla aunque todavía me resulte más familiar la anterior. | low | low | medium | apego_normas | high | low | — | 080, 049 | KEEP_PRIORITY | Familiar vs incorporar. Mejor trade-off de A; par de 080. |
| pm24_075 | A. Apertura operativa | D | Cuando aparecen condiciones nuevas en cómo debe ejecutarse un trabajo, suelo adaptar los pasos que suelo usar a esas condiciones. | medium | high | medium | orden_precision | high | low | — | 073 | DROP_CANDIDATE | Adaptar pasos habituales ≈ ajustar manera (073). |
| pm24_076 | B. Repriorización | D | Cuando cambia una prioridad durante la jornada, suelo reorganizar lo que estaba atendiendo para reflejar la nueva necesidad. | medium | high | high | orden_precision | high | low | — | 078, 009, 003 | REVIEW | Repriorizar por cambio de necesidad. Núcleo de B; cerca de 078 y frontera con 009. |
| pm24_077 | B. Repriorización | D | Si una tarea que iba después se vuelve necesaria para que otras puedan avanzar, suelo cambiar el orden previsto. | medium | low | high | liderazgo_equipos | high | medium | — | 044, 038 | KEEP_PRIORITY | Dependencias como *motivo* de reorden. Distinto de 076; solapa 044. |
| pm24_078 | B. Repriorización | D | Cuando cambia qué necesita resolverse primero, suelo ajustar el orden previsto aunque ya hubiera comenzado otra actividad. | medium | high | medium | logro_persistencia · orden | high | low | — | 076, 008 | DROP_CANDIDATE | Misma repriorización que 076 con “ya había empezado”. Aporta poco tras v3.5. |
| pm24_079 | C. Ajuste de estrategia | D | Cuando un método deja de ajustarse a las condiciones del trabajo, suelo modificarlo en lugar de mantenerlo solo porque ya había empezado así. | medium | low | medium | logro_persistencia | high | low | — | 004, 080 | KEEP_PRIORITY | Cambiar el *cómo* sin abandonar el *qué*. Frontera persistencia controlada. |
| pm24_080 | C. Ajuste de estrategia | I | Cuando una forma de trabajo me ha funcionado bien, prefiero mantenerla mientras sea posible antes de cambiar a otra. | low | low | high | apego_normas | high | low | alta | 074, 049 | KEEP_PRIORITY | Continuidad legítima. Inverso fuerte. Correlación esperable con 049. |

---

## C. Redundancias intradimensión

### Dim. 1 — Logro / persistencia

| Par / grupo | Qué comparten | Más limpio | Qué aporta el otro |
|-------------|---------------|------------|--------------------|
| **001 ↔ 003** | Esfuerzo hacia el resultado/objetivo principal frente a otros pendientes | **003** (disparador: tareas secundarias) | **001** prioriza entre pendientes abiertos por contribución |
| **004 ↔ 005** | Seguir intentando cuando la tarea se complica / pide más intentos | **004** | **005** solo añade “aunque más lento” — poco diferencial |
| **007 ↔ 008** | Cerrar lo que quedó abierto | **008** (retomar tras otra prioridad) | **007** cierra colas *después* de la parte principal |

### Dim. 2 — Orden y precisión

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **009 ↔ 011** | Definir secuencia antes de ejecutar | **009** | **011** es la misma conducta sobre “pasos” |
| **012 ↔ 014** | Detectar discrepancias en datos/detalles | **012** (contraste entre partes) | **014** enfatiza diferencias *pequeñas* / cifras |
| **015 ↔ 016** | Revisión extra al cierre vs avanzar si ya basta | Par complementario (no redundancia tóxica) | Conservar ambos |

### Dim. 3 — Autonomía

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **020 ↔ 022** | Elegir una alternativa razonable y seguir | **022** | **020** mezcla con “antes de segunda opinión” (faceta A) |
| **023 ↔ 024** | No adoptar de entrada la lectura/recomendación ajena | Empate; **023** un poco más general | **024** ancla “recomendación + lo que observo” |

### Dim. 4 — Influencia

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **025 ↔ 026 ↔ 027** | Exponer/desarrollar razones de una idea o postura | **026** (profundidad vs solo plantear) | **025/027** son el mismo acto ante desacuerdo |
| **028 ↔ 029** | Otra formulación del mensaje | **029** (incomprensión) | **028** (falta de convicción = persistir en persuadir) |

### Dim. 5 — Sociabilidad

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **033 ↔ 035** | Contacto directo para coordinar / obtener información | **033** (poco conocido) | **035** es “ir a la persona involucrada” en trabajo compartido |
| **036 ↔ 038** | Ajustar/informar para no bloquear a otros | **036** | **038** se lee ya como coordinación de equipo (liderazgo) |

### Dim. 6 — Liderazgo

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **041 ↔ 042 ↔ 043** | Entrar a organizar cuando el grupo no tiene dirección | **043** (nadie coordina el arranque) | **041** es la versión más vaga; **042** “proponer organizar” |
| **044 ↔ 045** | Hacer visibles orden/dependencias del trabajo grupal | **044** (qué va primero) | **045** nombra “dependencias” — mismo indicador |

### Dim. 7 — Apego a normas

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **049 ↔ 050 ↔ 051** | Partir del método/secuencia/procedimiento establecido | **051** (aun conociendo la tarea) | **049** vs explorar otra forma; **050** vs criterio propio |
| **052 ↔ 053** | Preferir parámetro externo frente a criterio personal | **052** | **053** exige entregas comparables entre personas |

### Dim. 8 — Regulación

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **060 ↔ 061 ↔ 062** | Recuperar foco tras contratiempo/error | **060 + 062** (par directo/inverso) | **061** particulariza rumiación de un error |
| **063 ↔ 064** | Seguir funcionando tras resultado adverso | **064** (crítica, mismo tema) | **063** “pasar al siguiente asunto” (dinamismo) |

### Dim. 9 — Dinamismo

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **065 ↔ 066 ↔ 067** | Mantenerse ocupado con lo disponible vs huecos/espera | **067** (ratos sin actividad inmediata) | **065/066** son el mismo trade-off con otra frase |
| **068 ↔ 069 ↔ 070** | Empezar cuando ya hay suficiente para arrancar | **068** | **069** detalles menores; **070** “me indican + empiezo” |

### Dim. 10 — Adaptabilidad

| Par / grupo | Qué comparten | Más limpio | Diferencial |
|-------------|---------------|------------|-------------|
| **073 ↔ 075** | Ajustar manera/pasos cuando cambia el cómo | **073** | **075** “pasos que suelo usar” — misma conducta |
| **076 ↔ 078** | Cambiar el orden cuando cambia qué va primero | **076** | **078** añade “aunque ya había empezado” — poco extra |
| **074 ↔ 080** | Incorporar lo nuevo vs conservar lo que funciona | Par complementario | Conservar ambos |

---

## D. Solapamientos interdimensión

Fronteras históricamente sensibles. En cada fila, **constructo dominante** = el que mejor explica la respuesta si se fuerza una sola dimensión.

| Reactivos | Frontera | Qué se comparte | Constructo dominante | Notas |
|-----------|----------|-----------------|----------------------|-------|
| **001 / 003 ↔ 076** | Logro vs Adaptabilidad | Atención entre pendientes cuando hay más de una necesidad | **001/003** = proteger el objetivo acordado; **076** = reordenar *porque el contexto cambió* | Ortogonales en teoría; en formulario corto pueden correlacionar negativo |
| **004 / 005 ↔ 079** | Persistencia vs Adaptabilidad | Seguir con la tarea vs cambiar método | **004** = nuevos intentos (mismo cómo); **079** = cambiar cómo | Distinción crítica; vigilar en pilotaje |
| **004 / 060 / 061** | Persistencia vs Regulación | Seguir tras dificultad / reconcentrarse | **004** obstáculo de tarea; **060/061** arrastre emocional/atencional | No fusionar |
| **008 ↔ 078** | Persistencia vs Adaptabilidad | Tarea empezada + otra prioridad | **008** = *retomar y cerrar* lo dejado; **078** = *dejar* lo empezado para reordenar | Complementarios |
| **009 / 011 ↔ 076 / 078** | Orden vs Repriorización | Orden de atención | **009** crea el orden; **076/078** lo cambian | La más sensible de Orden–Adaptabilidad |
| **011 ↔ 050** | Orden vs Apego a normas | Secuencia de pasos | **011** = yo ordeno; **050** = sigo secuencia *definida* | Mantener ambos si se recorta: uno por dimensión |
| **015 / 016 ↔ 052 / 056** | Orden vs Apego | Revisión al cierre | **015/016** = control de calidad propio; **052** = criterio *establecido* de terminada; **056** = momento de controles del proceso | 016 ∥ 056: riesgo empírico |
| **017 / 018 ↔ 035** | Autonomía vs Sociabilidad | Duda / información faltante | **018** explorar solo; **035** ir a la persona | Polaridad útil, no contaminación |
| **019 ↔ 055** | Autonomía vs Apego | Revisiones / autorización | **019** = utilidad de revisiones *con el responsable*; **055** = punto *del proceso* | Distintos referentes |
| **021 ↔ 069** | Autonomía vs Dinamismo | Información incompleta | **021** = *decidir*; **069** = *iniciar* la parte definida | Conservar uno de cada |
| **025 / 031 ↔ 042** | Influencia vs Liderazgo | Conversación grupal sin cierre | **031** argumentos hacia conclusión; **042** organizar el avance | Frontera real; no son paráfrasis |
| **028 / 029 ↔ 073** | Influencia vs Adaptabilidad | “Otra manera / reformular” | Dominan **comunicación**, no cambio de método de trabajo | Contaminación baja |
| **038 ↔ 044 / 077** | Sociabilidad vs Liderazgo vs Adaptabilidad | Desbloquear a otros cambiando orden/alineación | **038** = alinear *mi* parte (coop.); **044** = aclarar para el *grupo*; **077** = yo cambio *mi* orden por dependencia | El trío más contaminado del banco |
| **040 ↔ 047 / 048** | Sociabilidad vs Liderazgo | Trabajo compartido con partes definidas | **040** (post 3B) = apoyo solo si lo piden; **048** = dejar la *coordinación* a otra persona | Ya no son equivalentes. Residual: ambos mencionan “mi parte”. |
| **043 ↔ 068 / 070** | Liderazgo vs Dinamismo | Arrancar | **043** arranque *grupal* cuando nadie coordina; **068/070** arranque *de mi* tarea | Condición grupal salva 043 |
| **049 / 051 ↔ 074 / 080** | Apego vs Adaptabilidad | Método establecido / familiar vs otro | **049/051** = partir del marco *vigente*; **074/080** = incorporar o conservar cuando *aparece* otra forma | Si 049 y 080 coexisten en 60 ítems, alta correlación esperada |
| **059 ↔ 076** | Regulación vs Adaptabilidad | Varias demandas / cambio de qué va primero | **059** = no dejar que la *presión* altere la forma de atender; **076** = reordenar por *nueva necesidad* | Distintos disparadores |
| **063 ↔ 071** | Regulación vs Dinamismo | Pasar al siguiente asunto | **063** tras *rechazo*; **071** tras *terminar una parte* | 063 más débil |
| **065–067 ↔ 001** | Dinamismo vs Logro | Atender lo disponible | **065–067** = nivel de actividad; **001** = *cuál* pendiente aporta al resultado | No son el mismo indicador |

**No se observó** contaminación primaria Regulación ↔ Adaptabilidad en el sentido emocional (ningún ítem de dim. 10 habla de calma, molestia o recuperación).

---

## E. Auditoría de los 10 inversos

| itemId | Dimensión | Naturalidad | Comprensión | Deseabilidad | Negación innecesaria | Riesgo de confusión | ¿Aporta contraste? | Recomendación editorial |
|--------|-----------|-------------|-------------|--------------|----------------------|---------------------|---------------------|-------------------------|
| pm24_006 | Logro | alta | alta | medium | no | bajo | sí (pausa táctica vs insistir) | **Prioritario** |
| pm24_016 | Orden | alta | alta | low | no | medio (∥ 056, 072) | sí | **Prioritario**; vigilar correlación |
| pm24_019 | Autonomía | alta | alta | low | no | bajo | sí | **Prioritario**; oportunidad: tener jefe |
| pm24_032 | Influencia | alta | alta | low | no | bajo | sí | **Prioritario** |
| pm24_040 | Sociabilidad | alta | alta | low | no | **bajo vs 048** (post 3B) | sí (apoyo a demanda vs espontáneo) | **Prioritario**; ya no duplica 048 |
| pm24_048 | Liderazgo | alta | alta | low | no | **alto vs 040** | sí *dentro* de liderazgo | Igual que 040: calidad alta, solapamiento interdimensión |
| pm24_056 | Apego | alta | alta | low | no | medio (∥ 016) | sí | **Prioritario**; no se lee como fraude |
| pm24_062 | Regulación | alta | alta | low | no | bajo | sí (tiempo vs reconcentrarse) | **Prioritario** |
| pm24_072 | Dinamismo | alta | alta | low | no | medio (∥ 016) | sí | **Prioritario** |
| pm24_080 | Adaptabilidad | alta | alta | low | no | medio (∥ 049) | sí | **Prioritario**; no conservar *solo* por cuota de inverso |

**Conclusión:** ninguno de los 10 es un inverso caricaturesco ni se sostiene “solo porque debe haber uno”. Los tres con más fricción de *sistema* (no de calidad local) son **040 ∥ 048**, **016 ∥ 056 ∥ 072** (familia “avanzar / no revisar / pausar”) y **080 ∥ 049**.

No se fuerza un inverso por dimensión en la shortlist de 60: de hecho **los 10 inversos quedan en prioritarios** porque su calidad conceptual es alta y cubren el polo de continuidad/especialista/pausa. El riesgo no es conservar inversos débiles, sino **conservar dos inversos que miden el mismo polo interpersonal** (040 y 048).

---

## F. Cobertura de facetas

| Dimensión | Facetas (3) | ¿Sobrerrepresentada? | ¿Alguna depende de ítems débiles? | Si se baja de 8 → ~6 |
|-----------|-------------|----------------------|-----------------------------------|----------------------|
| 1 Logro | A metas · B persistencia · C cierre | A y B ligeramente (001/003; 004/005) | C queda corta si se reservan 007 y 008 | 2+2+2 viable (002/003, 004/006, 007/008) |
| 2 Orden | A org. · B detalle · C revisión | A y B (009/011; 012/014) | C sólida (015/016) | 2+2+2 (009/010, 012/013, 015/016) |
| 3 Autonomía | A autogestión · B decisión · C criterio | B (020/022) | C solo 2 ítems en el banco | Shortlist 3B: 2+2+2 (017/019, 021/022, 023/024) |
| 4 Influencia | A argumentar · B mensaje · C movilizar | **A tríada** | C depende de 031 (frontera liderazgo) + 032 | 2+2+2 (025/026, 029/030, 031/032) |
| 5 Sociabilidad | A apertura · B coop. · C apoyo | B (036/038) | C sólida (039/040) | 2+2+2 (033/034, 036/037, 039/040) |
| 6 Liderazgo | A dirección · B coordinación · C colectivo | **A tríada** | B si se caen 044 y 045 a la vez | 2+2+2 (042/043, 044/046, 047/048) |
| 7 Apego | A procedimiento · B estándar · C control | **A tríada** | C sólida (055/056) | 2+2+2 (050/051, 052/054, 055/056) |
| 8 Regulación | A autocontrol · B recuperación · C crítica | B (060/061) | A pierde 057 en shortlist 3B | Shortlist 3B: 2+2+2 (058/059, 060/062, 063/064) |
| 9 Dinamismo | A actividad · B inicio · C ritmo | **A tríada** | C sólida (071/072) | 2+2+2 (065/067, 068/069, 071/072) |
| 10 Adaptabilidad | A apertura · B repriorizar · C estrategia | A y B (073/075; 076/078) | C sólida (079/080) | 2+2+2 (073/074, 076/077, 079/080) |

Ninguna faceta debería sacrificarse solo para llegar a 6. Tras Fase 3B, Autonomía C y Regulación C quedan en **2 ítems** cada una en la shortlist editorial. Faceta A de Autonomía y de Regulación queda en 2 (017/019 y 058/059).

---

## G. SHORTLIST EDITORIAL PROVISIONAL — 60 PRIORITARIOS / 20 RESERVAS

**No es selección final. No cambia `bankStatus`.** Criterio: claridad, pureza, cobertura de facetas, baja redundancia, neutralidad, aplicabilidad amplia.  
Ajustes 3B: swap **018 ↔ 024** · swap **057 ↔ 063**.

### Prioritarios (6 × 10 = 60)

| Dimensión | Prioritarios | Facetas cubiertas | Inverso incluido | ¿Desequilibrio al recortar? |
|-----------|--------------|-------------------|------------------|-----------------------------|
| 1 Logro | **002, 003, 004, 006, 007, 008** | A B C | 006 | No (2/2/2) |
| 2 Orden | **009, 010, 012, 013, 015, 016** | A B C | 016 | No (2/2/2) |
| 3 Autonomía | **017, 019, 021, 022, 023, 024** | A B C | 019 | No (2/2/2) — 3B |
| 4 Influencia | **025, 026, 029, 030, 031, 032** | A B C | 032 | No (2/2/2) |
| 5 Sociabilidad | **033, 034, 036, 037, 039, 040** | A B C | 040 | No (2/2/2) |
| 6 Liderazgo | **042, 043, 044, 046, 047, 048** | A B C | 048 | No (2/2/2); 040 ya no es paralelo |
| 7 Apego | **050, 051, 052, 054, 055, 056** | A B C | 056 | No (2/2/2) |
| 8 Regulación | **058, 059, 060, 062, 063, 064** | A B C | 062 | No (2/2/2) — 3B |
| 9 Dinamismo | **065, 067, 068, 069, 071, 072** | A B C | 072 | No (2/2/2) |
| 10 Adaptabilidad | **073, 074, 076, 077, 079, 080** | A B C | 080 | No (2/2/2) |

### Reservas (20)

| Dimensión | Reservas | Motivo breve |
|-----------|----------|--------------|
| 1 | **001, 005** | 001 deseabilidad + solapa 003; 005 paráfrasis de 004 |
| 2 | **011, 014** | Paráfrasis de 009 y 012 |
| 3 | **018, 020** | 018 cubría A de más; 020 mezcla A+B |
| 4 | **027, 028** | 027 paráfrasis de 025; 028 cerca de 029 |
| 5 | **035, 038** | 035 cerca de 033/018; 038 cerca de 044/077 |
| 6 | **041, 045** | Versiones más débiles de las tríadas A y B |
| 7 | **049, 053** | 049 cerca de 080; 053 oportunidad (entregas comparables) |
| 8 | **057, 061** | 057 contaminación sociabilidad; 061 cerca de 060 |
| 9 | **066, 070** | 066 paráfrasis de 065; 070 iniciativa obvia |
| 10 | **075, 078** | Paráfrasis de 073 y 076 |

**Lista plana de reservas:** 001, 005, 011, 014, 018, 020, 027, 028, 035, 038, 041, 045, 049, 053, 057, 061, 066, 070, 075, 078.

---

## H. Riesgos pendientes

1. **040 vs 048** — Cerrado en redacción 3B (apoyo a demanda vs dejar coordinación). Residual léxico: ambos hablan de “mi parte”. Vigilar correlación en pilotaje; ya no son equivalentes.
2. **016 ∥ 056 ∥ 072** — Familia “avanzar / no revisar ahora / pausar entre tareas”. Posible factor de *velocidad de cierre* ajeno a las tres dimensiones.
3. **049 ∥ 080** — Método que funciona / establecido. Mitigado dejando 049 en reserva; 050/051 siguen cubriendo apego.
4. **038 / 044 / 077** — Dependencias entre personas. Shortlist ya reserva 038; 044 y 077 siguen: vigilar correlación.
5. **Tríadas parafrásticas** (025–027, 041–043, 049–051, 065–067): si el pilotaje muestra α inflado y correlaciones ítem-ítem > 0.70, confirmar las reservas.
6. **Deseabilidad residual media-alta dentro de los 60:** **007**, **042**. (001 y 070 siguen en reserva.)
7. **063 ↔ 071** — Ambos “pasar al siguiente”; 063 ancla rechazo de propuesta. Frontera media; 063 volvió a prioritarios por cobertura de faceta C.
8. **023 ↔ 024** — Mismo núcleo de criterio propio; se conservan ambos para equilibrar Autonomía C. No son paráfrasis estricta, sí familia cercana.
9. **Oportunidad de experiencia:**
   - Trabajo grupal intenso: 034, 037–048, 077
   - Cifras / datos: 012, 014
   - Jefe / autorización formal: 019, 055
   - Propuestas / crítica: 063, 064
   - Interlocutores distintos: 030  
   Ninguno exige cargo formal de jefe ni función comercial exclusiva.
10. **Claridad:** ítems largos (010, 037, 043, 065) pueden fatigar en batería de 60–80; no son ambiguos.

---

## I. Recomendaciones para revisión experta / pilotaje

1. Tratar esta shortlist como **hipótesis editorial**, no como corte de `production`.
2. El par **040 / 048** ya no es equivalente en redacción; confirmar empíricamente. Seguir vigilando **016 / 056 / 072**.
3. Pilotaje: estimar correlaciones intra-tríada (Influencia A, Liderazgo A, Apego A, Dinamismo A) y **023–024**, **063–071**.
4. Si un ítem KEEP falla empíricamente, preferir **activar una reserva de la misma faceta** (018, 057) antes de redactar uno nuevo.
5. Autonomía C y Regulación C ya no quedan en un solo ítem (decisión 3B).
6. Población de pilotaje: incluir roles **sin** equipo a cargo y **sin** procesos formales, para contrastar oportunidad de 019/041–048/055.
7. Siguiente fase sugerida: revisión humana de la shortlist 3B → solo entonces hablar de `pilot` / 60 ítems. **Sin activar el módulo.**

---

## Apéndice — Conteos de clasificación

**KEEP_PRIORITY (43):**  
002, 004, 006, 008, 010, 013, 015, 016, 017, 018, 019, 021, 026, 029, 030, 032, 033, 034, 037, 039, 040, 043, 046, 047, 048, 051, 052, 054, 055, 056, 057, 058, 059, 062, 064, 067, 068, 071, 072, 074, 077, 079, 080

**REVIEW (23):**  
001, 003, 007, 009, 012, 022, 023, 024, 025, 028, 031, 035, 036, 042, 044, 050, 053, 060, 063, 065, 069, 073, 076

**DROP_CANDIDATE (14):**  
005, 011, 014, 020, 027, 038, 041, 045, 049, 061, 066, 070, 075, 078

---

---

## Fase 3B — decisiones humanas post-auditoría

**FASE 3B — CONSOLIDACIÓN EDITORIAL CLOSED**

**SHORTLIST EDITORIAL PROVISIONAL:  
60 PRIORITARIOS / 20 RESERVAS**

**No es selección oficial de 60 `production`.** `bankStatus` sigue `draft` en los 80. Cobertura de los 60: **2 + 2 + 2** por dimensión. `pm24_040` actualizado y aprobado; `pm24_048` intacto.

### 1. Modificación de pm24_040 (único cambio de texto)

| Campo | Antes (3A) | Después (3B) |
|-------|------------|--------------|
| Texto | Cuando mi responsabilidad está claramente definida, prefiero concentrarme en mi parte sin involucrarme demasiado en el avance de los demás. | Cuando cada persona tiene claramente definida su parte, prefiero concentrarme en la mía y ofrecer apoyo en las demás solo cuando me lo solicitan. |
| dimensionId | sociabilidad_colaboracion | sin cambio |
| Faceta | C. Apoyo e integración | sin cambio |
| direction | inverse | sin cambio |
| bankStatus | draft | draft |

**Justificación:** 040 y 048 compartían el polo “concentrarme en mi propia parte / no involucrarme en el avance”. Eso medía la misma disposición (especialista individual) desde Sociabilidad y Liderazgo.

Tras 3B:

| Ítem | Constructo | Polo bajo (inverso) |
|------|------------|---------------------|
| **pm24_040** | Involucramiento / apoyo espontáneo en trabajo compartido | Apoyo **solo cuando lo solicitan** |
| **pm24_048** | Disposición a asumir o dejar la **coordinación** grupal | Dejar la coordinación si ya hay participantes capaces |

**Confirmación de no equivalencia:** 040 ya no habla de “avance de los demás” ni de rehuir involucramiento grupal genérico; habla de *cuándo se ofrece apoyo*. 048 (intacto) habla de *quién coordina*. Un candidato puede puntuar alto en 040 (ayuda poco salvo que se lo pidan) y bajo en 048 (sí asume coordinación), o al revés.

`pm24_048` no se modificó.

### 2. Swap editorial Autonomía — 018 ↔ 024

| Ítem | 3A | 3B | Motivo |
|------|----|----|--------|
| pm24_018 | PRIORITARIO | **RESERVA** | Faceta A ya cubierta por 017 + 019; 018 es el tercer ítem de A |
| pm24_024 | RESERVA | **PRIORITARIO** | Restaura faceta C a 2 ítems (023 + 024) |

Shortlist Autonomía 3B: **017, 019, 021, 022, 023, 024** → A 017/019 · B 021/022 · C 023/024.

`bankStatus` sin cambio.

### 3. Swap editorial Regulación — 057 ↔ 063

| Ítem | 3A | 3B | Motivo |
|------|----|----|--------|
| pm24_057 | PRIORITARIO | **RESERVA** | Contaminación residual con Sociabilidad (forma de respuesta en conversación tensa) |
| pm24_063 | RESERVA | **PRIORITARIO** | Restaura faceta C a 2 ítems (063 + 064) |

Shortlist Regulación 3B: **058, 059, 060, 062, 063, 064** → A 058/059 · B 060/062 · C 063/064.

`bankStatus` sin cambio.

### 4. Recuento post-3B

| Conjunto | n |
|----------|---|
| Prioritarios | **60** (6 × 10) |
| Reservas | **20** (2 × 10) |
| Banco total | 80 `draft` |

---

**FASE 3B — CONSOLIDACIÓN EDITORIAL CLOSED**

**SHORTLIST EDITORIAL PROVISIONAL:  
60 PRIORITARIOS / 20 RESERVAS**

*Módulo inactivo. Sin selección oficial de 60. Sin iniciar Fase 3C en este cierre.*
