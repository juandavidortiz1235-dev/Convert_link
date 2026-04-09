document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('converter-form');
    const urlInput = document.getElementById('media-url');
    const btnText = document.querySelector('.btn-text');
    const loader = document.querySelector('.loader');
    const statusMessage = document.getElementById('status-message');
    const submitBtn = document.getElementById('download-btn');
    
    // Progress Bar elements
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = urlInput.value.trim();
        const format = document.querySelector('input[name="format"]:checked').value;

        if (!url) return;

        // Set Loading State
        submitBtn.disabled = true;
        btnText.classList.add('hidden');
        loader.classList.add('visible');
        
        statusMessage.className = 'hidden';
        statusMessage.textContent = '';
        
        // Reset progress bar
        progressContainer.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressText.textContent = 'Iniciando descarga...';

        const fileId = 'media_' + Date.now();
        
        // Iniciar la escucha del progreso (Server-Sent Events)
        const eventSource = new EventSource('/api/progress/' + fileId);
        
        eventSource.onmessage = (event) => {
            const data = event.data;
            if (data === 'connected') {
                 // Conexión establecida
            } else if (data === 'extracting') {
                 progressBarFill.style.width = '99%';
                 progressText.textContent = 'Procesando (Extrayendo audio)...';
            } else if (data === 'done') {
                 progressBarFill.style.width = '100%';
                 progressText.textContent = '¡Completado, preparando archivo...!';
                 eventSource.close();
            } else {
                 const percentage = parseFloat(data);
                 if (!isNaN(percentage)) {
                     progressBarFill.style.width = percentage + '%';
                     progressText.textContent = `Descargando: ${percentage.toFixed(1)}%`;
                 }
            }
        };
        
        eventSource.onerror = (err) => {
            console.error("EventSource failed.", err);
            eventSource.close();
        };

        try {
            const response = await fetch('/api/convert', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url, format, fileId })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Ocurrió un error inesperado al procesar tu solicitud.');
            }

            if (data.success && data.downloadUrl) {
                // Actualizar UI
                progressContainer.classList.add('hidden');
                statusMessage.textContent = '¡Procesamiento exitoso! Tu descarga empezó automáticamente.';
                statusMessage.className = 'success';
                
                // Forzar descarga construyendo un ancla (<a>) HTML dinámica
                // Esto asegura que el navegador obligatoriamente lo baje si es video y no lo lance en otra ventana
                const a = document.createElement('a');
                a.href = data.downloadUrl;
                a.setAttribute('download', '');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        } catch (error) {
            console.error('Error in conversion:', error);
            statusMessage.textContent = error.message;
            statusMessage.className = 'error';
            progressContainer.classList.add('hidden');
            eventSource.close();
        } finally {
            // Restore Btn State
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            loader.classList.remove('visible');
        }
    });
});
