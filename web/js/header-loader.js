// header-loader.js - Charge le header commun et gère la navigation active

async function loadHeader(config = {}) {
    const {
        activePage = '',
        title = 'R#BD',
        subtitle = ''
    } = config;

    try {
        // Déterminer le chemin relatif vers components/header.html
        const isInSubfolder = window.location.pathname.includes('/pages/');
        const headerPath = isInSubfolder ? '../components/header.html' : './web/components/header.html';

        const response = await fetch(headerPath);
        const html = await response.text();

        // Créer un conteneur temporaire
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Injecter dans le body
        const header = temp.querySelector('header');
        document.body.insertBefore(header, document.body.firstChild);

        // Ajuster les chemins si on est dans un sous-dossier
        if (isInSubfolder) {
            // Ajuster le logo
            const logo = header.querySelector('.guide-logo');
            if (logo) {
                logo.src = '../../assets/RCONTROLE.png';
            }

            // Ajuster les liens de navigation
            const navButtons = header.querySelectorAll('.nav-button');
            navButtons.forEach(btn => {
                const href = btn.getAttribute('href');
                if (href && !href.startsWith('#')) {
                    if (href === './index.html') {
                        btn.setAttribute('href', '../../index.html');
                    } else if (href.startsWith('./web/pages/')) {
                        btn.setAttribute('href', href.replace('./web/pages/', './'));
                    }
                }
            });
        }

        // Mettre à jour le titre
        const headerTitle = document.getElementById('header-title');
        if (headerTitle) {
            headerTitle.textContent = title;
            if (subtitle) {
                headerTitle.textContent = `${title} - ${subtitle}`;
            }
        }

        // Activer le bouton de navigation correspondant
        if (activePage) {
            const navButtons = document.querySelectorAll('.nav-button');
            navButtons.forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('data-page') === activePage) {
                    btn.classList.add('active');
                }
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement du header:', error);
    }
}
