// Authentication middleware functions

const jwt = require('jsonwebtoken');

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).send('Access denied. No token provided.');

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).send('Invalid token.');
        req.user = user;
        next();
    });
};

// Middleware to check if user has specific permissions
const authorize = (permissions) => {
    return (req, res, next) => {
        const userPermissions = req.user.permissions || [];
        const hasPermission = permissions.every(permission => userPermissions.includes(permission));
        if (!hasPermission) return res.status(403).send('Access denied.');
        next();
    };
};

module.exports = { isAuthenticated, authorize };