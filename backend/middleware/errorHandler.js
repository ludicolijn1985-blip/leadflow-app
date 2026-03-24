// errorHandler.js

// Error handling middleware for Express server

const errorHandler = (err, req, res, next) => {
    res.status(err.status || 500);
    res.json({
        message: err.message,
        error: process.env.NODE_ENV === 'development' ? err : {},
    });
};

module.exports = errorHandler;
