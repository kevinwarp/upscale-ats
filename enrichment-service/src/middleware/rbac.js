const db = require('../db');
const logger = require('../utils/logger');

/**
 * Role-based access control for stage transitions and admin actions.
 *
 * Checks that the user (from x-user-id header) has the required role.
 * Roles are looked up from the user table's access_level column.
 *
 * Usage:
 *   router.patch('/stage', rbac('recruiter'), handler);
 *   router.put('/stages', rbac('admin'), handler);
 */
function rbac(...allowedRoles) {
  return async (req, res, next) => {
    const userId = parseInt(req.headers['x-user-id']);

    if (!userId) {
      return res.status(401).json({ error: 'x-user-id header required' });
    }

    try {
      const [rows] = await db.query(
        'SELECT access_level FROM user WHERE user_id = ?',
        [userId]
      );

      if (rows.length === 0) {
        return res.status(403).json({ error: 'User not found' });
      }

      const userRole = mapAccessLevel(rows[0].access_level);

      if (!allowedRoles.includes(userRole) && !allowedRoles.includes('any')) {
        logger.warn('RBAC denied', { userId, userRole, required: allowedRoles });
        return res.status(403).json({
          error: 'Insufficient permissions',
          required_role: allowedRoles,
          current_role: userRole,
        });
      }

      req.userRole = userRole;
      req.userId = userId;
      next();
    } catch (err) {
      logger.error('RBAC check failed', { error: err.message, userId });
      // Fail open for DB errors — log but allow (prevent service disruption)
      req.userRole = 'unknown';
      req.userId = userId;
      next();
    }
  };
}

/**
 * Map OpenCATS access_level integer to role string.
 * OpenCATS access levels: 500=admin, 400=recruiter, 300=hiring_manager, 200=interviewer, 100=readonly
 */
function mapAccessLevel(level) {
  if (level >= 500) return 'admin';
  if (level >= 400) return 'recruiter';
  if (level >= 300) return 'hiring_manager';
  if (level >= 200) return 'interviewer';
  return 'readonly';
}

module.exports = rbac;
module.exports.mapAccessLevel = mapAccessLevel;
