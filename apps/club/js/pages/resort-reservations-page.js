(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const fields = {
        hotel: $("resortHotelTab"), society: $("resortSocietyTab"),
        form: $("resortForm"), formTitle: $("resortFormTitle"), hint: $("resortFormHint"),
        course: $("resortCourse"), date: $("resortDate"), start: $("resortStart"),
        players: $("resortPlayers"), lead: $("resortLead"), contact: $("resortContact"),
        ref: $("resortRef"), names: $("resortNames"), notes: $("resortNotes"),
        overrideLabel: $("resortOverrideLabel"), override: $("resortOverride"), expiry: $("resortExpiryLabel"), hold: $("resortHoldLabel"),
        status: $("resortStatus"), holdHours: $("resortHoldHours"),
        preview: $("resortPreview"), create: $("resortCreate"),
        namesHint: $("resortNamesHint"), error: $("resortError"), success: $("resortSuccess"),
        content: $("resortContent"), list: $("resortReservations"), empty: $("resortEmpty"),
        from: $("resortFrom"), to: $("resortTo"), refresh: $("resortRefresh"),
        apply: $("resortApplyFilter")
    };
    const state = { club: null, caps: null, kind: "hotel", courses: [], slots: [], reservations: [], busy: false };
    function escapeHtml(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
    function localIso(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
    }
    function daysAfter(days) { const d = new Date(); d.setDate(d.getDate()+days); return localIso(d); }
    function parseNames() { return fields.names.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); }
    function readable(e) { return String(e?.message || e?.details || e || "An unexpected error occurred."); }
    function message(text, failure = false) {
        fields.error.hidden = !failure; fields.success.hidden = failure;
        (failure ? fields.error : fields.success).textContent = String(text);
    }
    async function rpc(name, data) {
        const { data: result, error } = await window.supabaseClient.rpc(name, data);
        if (error) throw error;
        return result;
    }
    function busy(flag) { state.busy=flag; fields.create.disabled=flag; fields.create.textContent=flag?"Saving booking…": (state.kind==="hotel"?"Confirm hotel tee time":"Save society booking"); }
    function switchKind(kind) {
        if (kind === "hotel" && !state.caps.can_hotel || kind === "society" && !state.caps.can_society) return;
        state.kind=kind;
        fields.hotel.classList.toggle("active", kind==="hotel");
        fields.society.classList.toggle("active", kind==="society");
        fields.hotel.setAttribute("aria-pressed",String(kind==="hotel"));
        fields.society.setAttribute("aria-pressed",String(kind==="society"));
        fields.hold.hidden=kind!=="society"; fields.expiry.hidden=kind!=="society" || fields.status.value!=="provisional";
        fields.formTitle.textContent=kind==="hotel"?"Confirm a hotel golf booking":"Allocate consecutive society tee times";
        fields.hint.textContent=kind==="hotel"
            ?"Choose the exact tee time, provide all golfer names and link the accommodation reference. Confirmation books golf immediately."
            :"The chosen start time and following consecutive tee times are allocated to the group. Provisional holds expire after 12–48 hours.";
        fields.namesHint.textContent=kind==="hotel"?"One name per golfer, required before confirmation.":"Optional for a provisional hold. For confirmation provide all names or leave blank to mark players as awaiting details.";
        fields.players.max=kind==="hotel"?"8":"128";
        fields.ref.required=kind==="hotel";
        fields.create.textContent=kind==="hotel"?"Confirm hotel tee time":"Save society booking";
        preview();
    }
    function selectedSlot() { return state.slots.find((s) => s.id===fields.start.value); }
    function preview() {
        const players=Number(fields.players.value) || 0;
        const slot=selectedSlot();
        const names=parseNames();
        if (!slot) { fields.preview.textContent="Select an available starting tee time.";return; }
        if (state.kind==="hotel") {
            fields.preview.textContent=`${slot.time.slice(0,5)} · ${players} golfer(s) · ${names.length} named · ${slot.allocation} allocation. Golf is confirmed immediately.`;
        } else {
            let needed=players, count=0;
            const startIndex=state.slots.findIndex((s)=>s.id===slot.id);
            for (const s of state.slots.slice(startIndex)) {
                if (!s.open) break;
                needed-=Math.min(needed,Number(s.max_players)); count++;
                if (needed<=0) break;
            }
            fields.preview.textContent=needed>0?"Insufficient consecutive available tee times; choose another start time.":`${players} golfers across ${count} consecutive tee time(s), starting ${slot.time.slice(0,5)}.`;
        }
    }
    async function loadSlots() {
        fields.start.innerHTML='<option value="">Loading tee times…</option>';
        if (!fields.course.value || !fields.date.value) return;
        try {
            const data=await rpc("resort_day_tee_times",{
                p_club_id:state.club.id,p_course_id:fields.course.value,p_play_date:fields.date.value
            });
            state.slots=Array.isArray(data)?data:[];
            fields.start.innerHTML='<option value="">Select first tee time</option>'+state.slots.map((s)=>
                `<option value="${escapeHtml(s.id)}" ${s.open?"":"disabled"}>${escapeHtml(String(s.time).slice(0,5))} · ${escapeHtml(s.allocation)}${s.open?"":" · unavailable"}</option>`
            ).join("");
            preview();
        } catch(e) { fields.start.innerHTML='<option value="">Unavailable</option>';message(readable(e),true); }
    }
    function reservationMarkup(r) {
        const times=(r.slots||[]).map((s)=>String(s.start_time).slice(0,5));
        const status=String(r.status||"");
        const canEdit=r.kind==="hotel"?state.caps.can_hotel:state.caps.can_society;
        const actions=(canEdit && status==="provisional"?`<button class="resort-button" data-action="confirm" data-id="${escapeHtml(r.id)}">Confirm society</button>`:"")+
            (canEdit && ["provisional","confirmed","partially_changed"].includes(status)?`<button class="resort-button secondary" data-action="cancel" data-id="${escapeHtml(r.id)}">Cancel booking</button>`:"");
        return `<article class="resort-reservation"><div class="resort-reservation__header"><strong>${escapeHtml(r.lead_name)}</strong><span class="resort-pill resort-pill--${escapeHtml(status)}">${escapeHtml(status)}</span></div>
        <div class="resort-reservation__meta">${r.kind==="hotel"?"Hotel guest":"Society"} · ${escapeHtml(r.party_size)} golfer(s) · ${escapeHtml(String(r.play_date||""))} · ${escapeHtml(times.join(", "))}</div>
        ${r.accommodation_ref?`<div class="resort-reservation__meta">Accommodation ref: ${escapeHtml(r.accommodation_ref)}</div>`:""}
        ${r.contact_number?`<div class="resort-reservation__meta">Contact: ${escapeHtml(r.contact_number)}</div>`:""}
        ${status==="provisional"?`<div class="resort-reservation__meta">Expires ${escapeHtml(new Date(r.hold_expires_at).toLocaleString("en-GB"))}</div>`:""}
        ${r.notes?`<div class="resort-reservation__meta">${escapeHtml(r.notes)}</div>`:""}
        <div class="resort-reservation__actions">${actions}</div></article>`;
    }
    async function loadReservations() {
        try {
            const data=await rpc("resort_list_reservations",{
                p_club_id:state.club.id,p_from:fields.from.value,p_to:fields.to.value
            });
            state.reservations=Array.isArray(data)?data:[];
            fields.empty.hidden=state.reservations.length>0;
            fields.empty.textContent="No hotel or society bookings in this date range.";
            fields.list.innerHTML=state.reservations.map(reservationMarkup).join("");
        } catch(e) { message(readable(e),true); }
    }
    async function createBooking(e) {
        e.preventDefault(); if(state.busy) return;
        const size=Number(fields.players.value), names=parseNames();
        const provisional=state.kind==="society" && fields.status.value==="provisional";
        if (!Number.isInteger(size)||size<1||size>(state.kind==="hotel"?8:128)) return message("Invalid golfer count.",true);
        if (!provisional && (state.kind==="hotel" || names.length) && names.length!==size) return message("Provide one golfer name per player or, for a society, leave all names blank pending details.",true);
        if(!fields.start.value) return message("Select an available tee time.",true);
        if(state.kind==="hotel" && !fields.ref.value.trim()) return message("Enter the accommodation booking reference.",true);
        if(provisional && fields.override.checked) return message("Member allocation overrides require an immediately confirmed reservation.",true);
        if(!window.confirm(provisional?"Place a time-limited provisional society hold?":"Confirm real tee-time bookings now?")) return;
        busy(true);
        try {
            await rpc("resort_create_reservation",{
                p_club_id:state.club.id,p_kind:state.kind,p_first_tee_time_id:fields.start.value,
                p_party_size:size,p_lead_name:fields.lead.value.trim(),
                p_contact_number:fields.contact.value.trim()||null,
                p_accommodation_ref:fields.ref.value.trim()||null,p_notes:fields.notes.value.trim()||null,
                p_provisional:provisional,p_guest_names: names.length?names:null,
                p_hold_hours:Number(fields.holdHours.value),p_override_member:state.caps.can_override && fields.override.checked
            });
            message(provisional?"Society hold placed. Tee times are blocked until expiry or confirmation.":"Golf booking confirmed and added to the central tee sheet.");
            fields.names.value="";fields.notes.value="";
            await Promise.all([loadSlots(),loadReservations()]);
        } catch(e){ message(readable(e),true); }
        finally{busy(false);}
    }
    async function actOnReservation(e) {
        const btn=e.target.closest("button[data-action]"); if(!btn) return;
        const r=state.reservations.find((v)=>v.id===btn.dataset.id);if(!r) return;
        const action=btn.dataset.action;
        if(action==="cancel" && !window.confirm(`Cancel all allocated tee times for ${r.lead_name}?`))return;
        let names=null;
        if(action==="confirm"){
            if(!window.confirm(`Confirm ${r.party_size} golfers and ${(r.slots||[]).length} tee times? Unnamed golfers will be marked as details pending.`))return;
            const raw=window.prompt("Optional: enter all golfer names, separated by commas. Leave blank to mark names pending.","");
            if(raw===null)return;
            names=raw.trim()?raw.split(",").map((s)=>s.trim()):null;
            if(names && names.length!==Number(r.party_size))return message("Enter all golfer names, or leave the field blank.",true);
        }
        btn.disabled=true;
        try{
            await rpc(action==="confirm"?"resort_confirm_reservation":"resort_cancel_reservation",
                action==="confirm"?{p_reservation_id:r.id,p_guest_names:names}:{p_reservation_id:r.id});
            message(action==="confirm"?"Society booking confirmed.":"Reservation cancelled and its allocated tee times released.");
            await Promise.all([loadSlots(),loadReservations()]);
        } catch(err){message(readable(err),true);} finally{btn.disabled=false;}
    }
    async function initialise(){
        try{
            await window.Paryx.ready;
            const c=await window.Paryx.clubContext.ready;
            state.club=c?.activeClub||window.Paryx.clubContext.getActiveClub();
            if(!state.club?.id)throw new Error("Select a club to continue.");
            state.caps=await rpc("resort_staff_context",{p_club_id:state.club.id});
            if(!state.caps.enabled||(!state.caps.can_hotel&&!state.caps.can_society))
                throw new Error("Hotel Mode or reservation permissions are disabled in Paryx Console.");
            fields.content.hidden=false;fields.overrideLabel.hidden=!state.caps.can_override;fields.hotel.hidden=!state.caps.can_hotel;fields.society.hidden=!state.caps.can_society;
            fields.date.value=localIso();fields.date.min=localIso();fields.from.value=localIso();fields.to.value=daysAfter(30);
            const data=await rpc("staff_get_booking_courses",{p_club_id:state.club.id});
            state.courses=Array.isArray(data)?data:[];
            fields.course.innerHTML=state.courses.map((course)=>`<option value="${escapeHtml(course.course_id)}">${escapeHtml(course.course_name)}</option>`).join("");
            if(!state.courses.length)throw new Error("No active golf course is configured for this club.");
            fields.hotel.addEventListener("click",()=>switchKind("hotel"));
            fields.society.addEventListener("click",()=>switchKind("society"));
            fields.status.addEventListener("change",()=>switchKind(state.kind));
            [fields.course,fields.date].forEach((el)=>el.addEventListener("change",loadSlots));
            [fields.players,fields.names,fields.start].forEach((el)=>el.addEventListener("input",preview));
            fields.form.addEventListener("submit",createBooking);
            fields.list.addEventListener("click",actOnReservation);
            fields.refresh.addEventListener("click",loadReservations);
            fields.apply.addEventListener("click",loadReservations);
            switchKind(state.caps.can_hotel?"hotel":"society");
            await Promise.all([loadSlots(),loadReservations()]);
        }catch(err){message(readable(err),true);}
    }
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialise,{once:true});
    else initialise();
})();
