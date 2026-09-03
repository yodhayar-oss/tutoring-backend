const { SUBJECTS } = require('./eligibility');

function serializeTicket(t) {
  const subj = SUBJECTS[t.subject_key];
  return {
    id: t.id,
    tuteeName: t.tutee_name,
    tuteeEmail: t.tutee_email,
    subjectKey: t.subject_key,
    subjectLabel: subj ? subj.label : t.subject_key,
    teacher: subj ? subj.teacher : '',
    subOption: t.sub_option,
    date: t.date,
    note: t.note,
    status: t.status,
    tutorEmail: t.tutor_email,
    claimedAt: t.claimed_at,
    hasProofPhoto: !!t.proof_photo_data,
    proofSubmittedAt: t.proof_submitted_at,
    createdAt: t.created_at
  };
}

function serializeTutor(t) {
  return {
    id: t.id,
    email: t.email,
    verificationStatus: t.verification_status,
    hasVerificationForm: !!t.verification_form_data,
    createdAt: t.created_at
  };
}

function serializeVolDoc(d) {
  return {
    id: d.id,
    tutorId: d.tutor_id,
    title: d.title,
    originalName: d.original_name,
    createdAt: d.created_at
  };
}

module.exports = { serializeTicket, serializeTutor, serializeVolDoc };
