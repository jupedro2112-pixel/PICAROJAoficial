/**
 * Rutas de Referidos
 * Endpoints de usuario y admin para el sistema de referidos
 */
const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { authenticate, authorize } = require('../middlewares/auth');

// =============================================
// Rutas de usuario (autenticadas)
// =============================================

// GET /api/referrals/me - código, link, stats del usuario actual
router.get('/me', authenticate, referralController.getMyReferralInfo);

// GET /api/referrals/summary - resumen de comisiones pendientes
router.get('/summary', authenticate, referralController.getMyReferralSummary);

// GET /api/referrals/history - historial de pagos del usuario
router.get('/history', authenticate, referralController.getMyReferralHistory);

// GET /api/referrals/pending - comisiones pendientes del período actual
router.get('/pending', authenticate, referralController.getMyPendingCommissions);

// #240: cobro desde la app — disponible (meses cerrados) y acreditación
router.get('/claimable', authenticate, referralController.getMyClaimable);
router.post('/claim', authenticate, referralController.claimMyCommission);

// =============================================
// Rutas de admin
// =============================================

// GET /api/referrals/admin/summary - resumen de todos los referidores
router.get('/admin/summary', authenticate, authorize('admin'), referralController.adminGetReferralsSummary);

// GET /api/referrals/admin/activity - actividad y evolución (referidos nuevos, activos, por mes) — #174
router.get('/admin/activity', authenticate, authorize('admin'), referralController.adminGetReferralActivity);

// GET /api/referrals/admin/payouts - historial de todos los pagos
router.get('/admin/payouts', authenticate, authorize('admin'), referralController.adminGetPayouts);

// GET /api/referrals/admin/relationships - lista de relaciones referidor→referido para auditoría
router.get('/admin/relationships', authenticate, authorize('admin'), referralController.adminGetReferralRelationships);

// GET /api/referrals/admin/users/:userId - detalle del referidor
router.get('/admin/users/:userId', authenticate, authorize('admin'), referralController.adminGetUserReferrals);

// POST /api/referrals/admin/calculate - ejecutar cálculo mensual
router.post('/admin/calculate', authenticate, authorize('admin'), referralController.adminCalculate);

// GET/POST /api/referrals/admin/rate - % de comisión del referidor (#351, editable en el panel)
router.get('/admin/rate', authenticate, authorize('admin'), referralController.adminGetRate);
router.post('/admin/rate', authenticate, authorize('admin'), referralController.adminSetRate);

// POST /api/referrals/admin/preview - preview sin guardar
router.post('/admin/preview', authenticate, authorize('admin'), referralController.adminPreview);

// POST /api/referrals/admin/payout - ejecutar pago mensual
router.post('/admin/payout', authenticate, authorize('admin'), referralController.adminPayout);

module.exports = router;
