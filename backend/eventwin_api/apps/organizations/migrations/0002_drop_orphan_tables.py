# Nettoyage de dérive de schéma — tables orphelines de l'ancien design.
#
# Constat (contrôlé, sauvegarde pg_dump effectuée avant) :
#   - ``organizations_organizerinvitation`` et ``organizations_passwordresettoken``
#     existaient en base (vestiges d'un ancien état du projet) alors que leurs
#     modèles n'étaient plus déclarés nulle part. Les deux tables sont
#     **vides** (0 ligne, vérifié). Leur ancien schéma portait un flux
#     d'invitation différent de l'implémentation actuelle.
#   - Le flux actuel vit dans ``apps.participants`` : modèles
#     ``OrganizerInvitation`` et ``PasswordResetToken`` (tables
#     ``participants_organizerinvitation`` / ``participants_passwordresettoken``),
#     avec jeton haché, usage unique, expiration, révocation et honnêteté
#     d'envoi. Cette migration supprime donc les deux tables orphelines vides.
#
# Aucune donnée n'est détruite (0 ligne). Réversible : la branche
# ``reverse_sql`` recrée les tables vides d'origine.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('organizations', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                'DROP TABLE IF EXISTS organizations_organizerinvitation;',
                'DROP TABLE IF EXISTS organizations_passwordresettoken;',
            ],
            reverse_sql=[
                (
                    'CREATE TABLE IF NOT EXISTS organizations_passwordresettoken ('
                    ' id uuid PRIMARY KEY,'
                    ' created_at timestamp with time zone NOT NULL,'
                    ' token_hash varchar(64) NOT NULL UNIQUE,'
                    ' expires_at timestamp with time zone NOT NULL,'
                    ' used_at timestamp with time zone NULL,'
                    ' user_id integer NOT NULL REFERENCES auth_user(id));'
                ),
                (
                    'CREATE TABLE IF NOT EXISTS organizations_organizerinvitation ('
                    ' id uuid PRIMARY KEY,'
                    ' created_at timestamp with time zone NOT NULL,'
                    ' email varchar(254) NOT NULL,'
                    ' full_name varchar(255) NOT NULL,'
                    ' token_hash varchar(64) NOT NULL UNIQUE,'
                    ' status varchar(100) NOT NULL,'
                    ' expires_at timestamp with time zone NOT NULL,'
                    ' accepted_at timestamp with time zone NULL,'
                    ' last_sent_at timestamp with time zone NULL,'
                    ' created_by_id integer NULL REFERENCES auth_user(id),'
                    ' organization_id uuid NULL REFERENCES organizations_organization(id));'
                ),
            ],
        ),
    ]
