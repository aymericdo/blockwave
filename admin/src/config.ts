/* Point d'entrée unique vers la configuration partagée : config.js vit à la
 * racine du dépôt et est aussi lu par l'extension. Le dupliquer ici ferait
 * diverger l'URL Supabase entre les deux. */
export { CONFIG } from '../../config.js';
