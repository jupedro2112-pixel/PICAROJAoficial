# Guía: cómo configurar un publicista (landing con su propio bono)

> Para el owner. Paso a paso para que la landing de un publicista muestre SU % de bono
> (ej. 50% en vez del 100% general) y que la primera carga se acredite con ese mismo %.
> Sin claves ni tokens en este archivo (el repo es público).

---

## 1. Crear la campaña en el panel

Panel → menú **📣 Publicidad** → **Publicidad 🔒** → **➕ Nueva campaña**.

| Campo | Qué poner | Ejemplo |
|---|---|---|
| **Código** * | Identificador ÚNICO. No se puede cambiar después. Sólo letras, números, `-` y `_` (3 a 40). | `META_JUAN_NOV26` |
| **Publicista** * | Nombre del publicista (para vos). | `Juan Pérez` |
| **Nombre de la campaña** * | Descripción. | `Meta Ads — noviembre 2026` |
| **Tipo de comisión / Valor** | CPA = $ por cliente que carga por primera vez · RevShare = % (0 a 100). | `CPA` · `5000` |
| **🎁 % de bono** | El % de la PRIMERA carga para los que entran por esta landing. **Vacío = el general (100%).** | `50` |
| **Hasta (carga $)** | Tope de la carga sobre la que se da ese %. Vacío = el general ($15.000). `0` = sin tope. | `20000` |
| **% sobre el resto** | % sobre lo que pase del tope. Vacío / 0 = nada. | `0` |
| **Notas** | Opcional. | |
| **Nombre del publicista en 1girox** | Opcional: sólo si el publicista tiene su propia cuenta en 1girox. | `subagente_juan` |
| **API key de 1girox** | Opcional: la key del publicista (empieza con `pk_`). Vacío = se usa la cuenta principal. | |

Tocá **Guardar**. Tiene que aparecer el cartel verde **"Campaña y bono guardados"**.
- Si aparece un mensaje en **rojo** ("la campaña se guardó, pero el % de bono NO…"), leé el motivo y tocá Guardar de nuevo.
- Para cambiar el % después: **Editar** la campaña → cambiá el % → **Guardar** (mismo cartel verde).
- El cambio tarda hasta **1 minuto** en aplicarse.

> El % de bono también se ve y se edita en **Configuración → 🆕 NUEVO → 🎁 Bono de bienvenida por publicista**
> (una fila por campaña, con tilde para pausarla: pausada = el general).

---

## 2. El link que le das al publicista

Usá SIEMPRE el link con el **código** de la campaña. Cualquiera de estos sirve:

| Landing | Link |
|---|---|
| Landing de pauta (Vercel) | `https://grupospicaroja.com/?p=META_JUAN_NOV26` |
| Landing de este servidor | `https://picaroja.com/l/META_JUAN_NOV26` |

- Se pueden agregar UTM al final: `&utm_source=facebook&utm_campaign=...`
- ❌ Un link SIN el código (`grupospicaroja.com` a secas) registra al cliente sin publicista ⇒ le toca el bono general.
- La landing de Vercel se actualiza desde **GitHub**: si cambiás algo de la landing y no hacés `git push origin main`, sigue mostrando lo viejo.

---

## 3. Probarlo (1 minuto)

1. Abrí el link del publicista en el celular (ventana privada). Arriba tiene que decir **50%** (o el % que pusiste) y el tope.
2. Si dice 100%: revisá (a) que el link tenga el código correcto, (b) que en el panel la campaña tenga el % guardado y activo, (c) que se haya hecho `git push` (landing de Vercel).
3. Para ver qué % devuelve el sistema para ese código, abrí:
   `https://picaroja.com/api/landing/info?c=META_JUAN_NOV26` → en `welcome` tiene que decir `"pct": 50` y `"fromCampaign": true`.

---

## 4. Qué pasa con el cliente

- Se registra por el link ⇒ queda marcado con esa campaña (en el panel: columna de campaña / "Publicidad").
- En la app ve **"🎁 Primera carga: +50% automático"** (el % de SU publicista).
- Su **PRIMERA carga real** (manual del agente o automática del banco) lleva ese % con ese tope y rollover ×5 (el global).
- Las cargas siguientes van con la estrategia normal (no con el % del publicista).

**Casos en que NO recibe el bono del publicista (es a propósito):**
- Cuenta **secundaria** (mismo teléfono / celular / notificaciones / CBU / titular que una cuenta más vieja) ⇒ sin bono de bienvenida.
- Cuenta marcada por **antifraude** ⇒ sin bono (queda nota en el chat para el agente).
- Se registró **sin el link** del publicista ⇒ bono general.
- Ya tenía cargas antes ⇒ no es primera carga.

---

## 5. Opcional

- **Píxel de Meta del publicista:** Configuración → **📣 Píxeles de Meta por publicista** (ID del píxel + token, se guarda cifrado). Así Meta recibe registros y cargas de SUS clientes.
- **Link de resultados para el publicista:** en la campaña, generá el link de resultados (`/r/<token>`): ve sólo números de su campaña, sin datos de clientes. Generar otro invalida el anterior.
- **Pausar la campaña:** Editar → destildá "Activa". Los ya registrados siguen marcados.

---

## Checklist rápido

- [ ] Campaña creada con **código** y **% de bono** → cartel verde "Campaña y bono guardados".
- [ ] Link con el código: `grupospicaroja.com/?p=CODIGO` o `picaroja.com/l/CODIGO`.
- [ ] Probado en el celular: la landing muestra el % correcto.
- [ ] `git push origin main` hecho (si se tocó la landing de Vercel).
- [ ] (Opcional) píxel de Meta cargado.
