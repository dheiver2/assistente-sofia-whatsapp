import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from './entities/contact.entity';
import { ContactsService } from './contacts.service';
import { ContactCaptureService } from './contact-capture.service';
import { ContactsController } from './contacts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Contact], 'data')],
  providers: [ContactsService, ContactCaptureService],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {}
