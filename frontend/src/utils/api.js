export const apiFetch = async (endpoint, options = {}) => {
    const token = localStorage.getItem('adminToken');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers
    };

    const response = await fetch(`http://localhost:5000/api${endpoint}`, {
        ...options,
        headers
    });

    if (response.status === 401) {
        // Token expired or invalid
        localStorage.removeItem('adminToken');
        window.location.href = '/';
    }

    return response;
};
